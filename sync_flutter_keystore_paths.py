import argparse
import base64
import json
import subprocess
from urllib.parse import quote


ORG = "GPC-Shared"
WORKFLOW_PATH = ".github/workflows/flutter-build.yml"
KEYSTORE_LINE = '          printf "%s" "$ANDROID_KEYSTORE_BASE64" | base64 --decode > android/upload-keystore.jks'
APP_KEYSTORE_COPY = "          cp android/upload-keystore.jks android/app/upload-keystore.jks"
STORE_FILE_LINE = "          storeFile=upload-keystore.jks"
CHMOD_LINE = "          chmod 600 android/key.properties android/upload-keystore.jks android/app/upload-keystore.jks"
CLEANUP_LINE = "        run: rm -f android/key.properties android/upload-keystore.jks android/app/upload-keystore.jks"


def gh(args, allow_missing=False):
    result = subprocess.run(["gh", "api", *args], capture_output=True, text=True)
    if result.returncode:
        if allow_missing and "404" in result.stderr:
            return None
        raise RuntimeError(result.stderr.strip() or "GitHub API request failed")
    return result.stdout


def gh_json(args, allow_missing=False):
    output = gh(args, allow_missing=allow_missing)
    return json.loads(output) if output is not None else None


def get_blob_text(repo, entry):
    blob = gh_json([f"repos/{repo}/git/blobs/{entry['sha']}"])
    return base64.b64decode(blob.get("content", "")).decode("utf-8", "replace")


def normalize_workflow(content):
    if "ANDROID_KEYSTORE_BASE64" not in content or "flutter build appbundle" not in content:
        return None

    lines = content.splitlines()
    changed = False
    decoded_keystore_indexes = [
        index for index, line in enumerate(lines)
        if "base64 --decode > android/" in line and line.rstrip().endswith("upload-keystore.jks")
    ]
    if len(decoded_keystore_indexes) != 1:
        return None

    index = decoded_keystore_indexes[0]
    indent = lines[index][:len(lines[index]) - len(lines[index].lstrip())]
    expected_write = indent + KEYSTORE_LINE.strip()
    if lines[index] != expected_write:
        lines[index] = expected_write
        changed = True
    if index + 1 >= len(lines) or lines[index + 1] != indent + APP_KEYSTORE_COPY.strip():
        lines.insert(index + 1, indent + APP_KEYSTORE_COPY.strip())
        changed = True

    property_indexes = [index for index, line in enumerate(lines) if "storeFile=" in line and "upload-keystore.jks" in line]
    if len(property_indexes) != 1:
        return None
    property_index = property_indexes[0]
    property_indent = lines[property_index][:len(lines[property_index]) - len(lines[property_index].lstrip())]
    normalized_property = property_indent + STORE_FILE_LINE.strip()
    if lines[property_index] != normalized_property:
        lines[property_index] = normalized_property
        changed = True

    chmod_indexes = [index for index, line in enumerate(lines) if "chmod 600 android/key.properties" in line]
    if len(chmod_indexes) != 1:
        return None
    chmod_index = chmod_indexes[0]
    chmod_indent = lines[chmod_index][:len(lines[chmod_index]) - len(lines[chmod_index].lstrip())]
    normalized_chmod = chmod_indent + CHMOD_LINE.strip()
    if lines[chmod_index] != normalized_chmod:
        lines[chmod_index] = normalized_chmod
        changed = True

    cleanup_indexes = [index for index, line in enumerate(lines) if "run: rm -f android/key.properties" in line]
    if len(cleanup_indexes) != 1:
        return None
    cleanup_index = cleanup_indexes[0]
    cleanup_indent = lines[cleanup_index][:len(lines[cleanup_index]) - len(lines[cleanup_index].lstrip())]
    normalized_cleanup = cleanup_indent + CLEANUP_LINE.strip()
    if lines[cleanup_index] != normalized_cleanup:
        lines[cleanup_index] = normalized_cleanup
        changed = True

    return "\n".join(lines) + "\n" if changed else None


def repository_is_android(repo, branch):
    tree = gh_json([f"repos/{repo}/git/trees/{quote(branch, safe='')}?recursive=1"])
    if tree.get("truncated"):
        return False
    paths = {entry.get("path") for entry in tree.get("tree", []) if entry.get("type") == "blob"}
    has_properties = "android/key.properties" in paths
    has_keystore = any(
        path and path.startswith(("android/", "app/")) and path.lower().endswith((".jks", ".keystore"))
        for path in paths
    )
    return has_properties and has_keystore


def workflow_for_branch(repo, branch):
    ref = quote(branch, safe="")
    file_data = gh_json([f"repos/{repo}/contents/{WORKFLOW_PATH}?ref={ref}"], allow_missing=True)
    if not file_data:
        return None
    content = base64.b64decode(file_data["content"]).decode("utf-8", "replace")
    updated = normalize_workflow(content)
    if not updated:
        return None
    return file_data, updated


def update_workflow(repo, branch, file_data, updated):
    payload = base64.b64encode(updated.encode("utf-8")).decode("ascii")
    args = [
        "--method", "PUT", f"repos/{repo}/contents/{WORKFLOW_PATH}",
        "-f", "message=Support both Android keystore lookup paths",
        "-f", f"branch={branch}",
        "-f", f"sha={file_data['sha']}",
        "-f", f"content={payload}",
    ]
    gh(args)


def main():
    parser = argparse.ArgumentParser(description="Normalize Flutter workflow keystore paths across Android repositories.")
    parser.add_argument("--apply", action="store_true", help="Update GitHub workflows; default is dry-run.")
    args = parser.parse_args()
    pages = gh_json([f"orgs/{ORG}/repos?per_page=100&type=all", "--paginate", "--slurp"])
    repos = [repo for page in pages for repo in page]
    counts = {"repositories": 0, "branches": 0, "changed": 0, "unchanged": 0, "skipped": 0, "failed": 0}
    examples = []

    for repo_info in repos:
        repo = repo_info["full_name"]
        default_branch = repo_info.get("default_branch") or "main"
        try:
            if not repository_is_android(repo, default_branch):
                counts["skipped"] += 1
                continue
            counts["repositories"] += 1
            branch_pages = gh_json([f"repos/{repo}/branches?per_page=100", "--paginate", "--slurp"])
            branches = [branch for page in branch_pages for branch in page]
            for branch_info in branches:
                branch = branch_info["name"]
                counts["branches"] += 1
                candidate = workflow_for_branch(repo, branch)
                if not candidate:
                    counts["unchanged"] += 1
                    continue
                file_data, updated = candidate
                if args.apply:
                    update_workflow(repo, branch, file_data, updated)
                counts["changed"] += 1
                if len(examples) < 10:
                    examples.append(f"{repo}@{branch}")
        except Exception as error:
            counts["failed"] += 1
            print(f"FAILED {repo}: {error}", flush=True)

    print("SUMMARY " + " ".join(f"{key}={value}" for key, value in counts.items()) + f" apply={str(args.apply).lower()}")
    for example in examples:
        print(f"UPDATED {example}")


if __name__ == "__main__":
    main()