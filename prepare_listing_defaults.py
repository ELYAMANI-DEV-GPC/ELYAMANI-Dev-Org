import argparse
import base64
import json
import re
import subprocess
from datetime import datetime, timezone
from urllib.parse import quote


ORG = "GPC-Shared"
LISTING_PATH = "docs/play_listing_defaults.json"
SCREENSHOT_LIMIT = 3
MAX_SCREENSHOT_BYTES = 4 * 1024 * 1024


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


def read_blob(repo, entry):
    blob = gh_json([f"repos/{repo}/git/blobs/{entry['sha']}"])
    return base64.b64decode(blob.get("content", "")).decode("utf-8", "replace")


def parse_store_listing(text):
    sections = {}
    current = None
    for line in text.splitlines():
        header = re.match(r"^(App name|Short description|Full description)\s*$", line.strip(), re.I)
        if header:
            current = header.group(1).lower()
            sections.setdefault(current, [])
        elif re.match(r"^(Category|Keywords|Contact|Website)\s*$", line.strip(), re.I):
            current = None
        elif current:
            sections[current].append(line)
    return {key: "\n".join(lines).strip() for key, lines in sections.items()}


def trim_text(value, limit):
    value = re.sub(r"\s+", " ", value).strip()
    if len(value) <= limit:
        return value
    return value[:limit - 3].rsplit(" ", 1)[0].rstrip(".,:; ") + "..."


def inspect_repository(repo, branch):
    tree = gh_json([f"repos/{repo}/git/trees/{quote(branch, safe='')}?recursive=1"])
    if tree.get("truncated"):
        return None

    entries = [entry for entry in tree.get("tree", []) if entry.get("type") == "blob"]
    by_path = {entry["path"]: entry for entry in entries}
    gradle_path = next((path for path in (
        "android/app/build.gradle.kts",
        "android/app/build.gradle",
        "app/build.gradle.kts",
        "app/build.gradle",
    ) if path in by_path), None)
    if not gradle_path:
        return None

    screenshots = sorted(
        entry["path"] for entry in entries
        if entry["path"].startswith("docs/screens/")
        and entry.get("size", 0) <= MAX_SCREENSHOT_BYTES
        and re.search(r"\.(png|jpe?g)$", entry["path"], re.I)
    )[:SCREENSHOT_LIMIT]
    if not screenshots:
        return None

    def read(path):
        entry = by_path.get(path)
        return read_blob(repo, entry) if entry else ""

    gradle = read(gradle_path)
    match = re.search(r"applicationId\s*(?:=\s*)?[\"']([^\"']+)[\"']", gradle)
    if not match:
        return None
    application_id = match.group(1)

    store = parse_store_listing(read("docs/store_listing.txt"))
    fastlane_root = "fastlane/metadata/android/en-US/"
    app_name = (
        store.get("app name")
        or read(fastlane_root + "title.txt").strip()
    )
    readme = read("README.md")
    if not app_name:
        strings = read("android/app/src/main/res/values/strings.xml") or read("app/src/main/res/values/strings.xml")
        match = re.search(r"<string\s+name=[\"']app_name[\"'][^>]*>([^<]+)</string>", strings, re.I)
        app_name = match.group(1).strip() if match else ""
    if not app_name:
        first_heading = next((line.lstrip("# ").strip() for line in readme.splitlines() if line.startswith("#")), "")
        app_name = first_heading or application_id.rsplit(".", 1)[-1].replace("_", " ").replace("-", " ").title()

    full_description = store.get("full description") or read(fastlane_root + "full_description.txt").strip()
    if not full_description:
        paragraphs = [
            part.strip() for part in re.split(r"\n\s*\n", re.sub(r"^\s*#.*$", "", readme, flags=re.M))
            if len(part.strip()) > 30 and not part.strip().startswith("![")
        ]
        full_description = "\n\n".join(paragraphs[:3])
    if not full_description:
        return None

    short_description = (
        store.get("short description")
        or read(fastlane_root + "short_description.txt").strip()
    )
    if not short_description:
        short_description = re.split(r"(?<=[.!?])\s+", full_description.strip(), maxsplit=1)[0]

    return {
        "branch": branch,
        "application_id": application_id,
        "listing": {
            "title": trim_text(app_name, 30),
            "short_description": trim_text(short_description, 80),
            "full_description": full_description.strip()[:4000],
            "source_screenshots": screenshots,
            "generated_from": "existing repository listing metadata and README",
            "generated_at": datetime.now(timezone.utc).isoformat(),
        },
    }


def prepare_repo(repo, branch, apply):
    context = inspect_repository(repo, branch)
    if not context:
        return "skipped", None

    current_file = gh_json(
        [f"repos/{repo}/contents/{LISTING_PATH}?ref={quote(branch, safe='')}"],
        allow_missing=True,
    )
    if current_file:
        current = json.loads(base64.b64decode(current_file["content"]).decode("utf-8"))
    else:
        current = {"schema_version": 1, "applications": {}}
    current.setdefault("applications", {})

    app_id = context["application_id"]
    if app_id in current["applications"]:
        return "skipped", context

    current["applications"][app_id] = context["listing"]
    if not apply:
        return "candidate", context

    payload = base64.b64encode((json.dumps(current, ensure_ascii=False, indent=2) + "\n").encode("utf-8")).decode("ascii")
    args = [
        "--method", "PUT", f"repos/{repo}/contents/{LISTING_PATH}",
        "-f", f"message=Add Play listing defaults for {app_id}",
        "-f", f"branch={branch}",
        "-f", f"content={payload}",
    ]
    if current_file:
        args.extend(["-f", f"sha={current_file['sha']}"])
    gh(args)
    return "created", context


def main():
    parser = argparse.ArgumentParser(description="Prepare Play listing defaults from existing repository text.")
    parser.add_argument("--apply", action="store_true", help="Write JSON files; default is dry-run.")
    args = parser.parse_args()
    repo_pages = gh_json([f"orgs/{ORG}/repos?per_page=100&type=all", "--paginate", "--slurp"])
    repos = [repo for page in repo_pages for repo in page]

    counts = {"created": 0, "candidate": 0, "skipped": 0, "failed": 0}
    previews = []
    for repo_info in repos:
        repo = repo_info["full_name"]
        branch = repo_info.get("default_branch") or "main"
        try:
            result, context = prepare_repo(repo, branch, args.apply)
            counts[result] += 1
            if context and len(previews) < 5 and result in {"candidate", "created"}:
                previews.append((repo, context["application_id"], context["listing"]["title"], context["listing"]["short_description"]))
        except Exception as error:
            counts["failed"] += 1
            print(f"FAILED {repo}: {error}")

    print(
        f"SUMMARY repositories={len(repos)} candidates={counts['candidate']} created={counts['created']} "
        f"skipped={counts['skipped']} failed={counts['failed']} apply={str(args.apply).lower()}"
    )
    for preview in previews:
        print("PREVIEW\t" + "\t".join(preview))


if __name__ == "__main__":
    main()