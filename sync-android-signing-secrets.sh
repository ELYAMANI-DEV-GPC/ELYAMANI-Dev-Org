#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: $0 OWNER/REPO [BRANCH] [KEY_PROPERTIES_PATH] [--keystore-path PATH] [--dry-run]" >&2
  exit 2
}

[[ $# -ge 1 ]] || usage
REPOSITORY=$1
BRANCH=${2:-main}
KEY_PROPERTIES_PATH=${3:-android/key.properties}
if [[ $# -ge 3 ]]; then shift 3; else shift "$#"; fi
KEYSTORE_PATH_OVERRIDE=
DRY_RUN=0
while [[ $# -gt 0 ]]; do
  case $1 in
    --dry-run) DRY_RUN=1; shift ;;
    --keystore-path)
      [[ $# -ge 2 ]] || usage
      KEYSTORE_PATH_OVERRIDE=$2
      shift 2
      ;;
    *) usage ;;
  esac
done

[[ $REPOSITORY =~ ^[^/]+/[^/]+$ ]] || usage
command -v gh >/dev/null || { echo 'GitHub CLI (gh) is required.' >&2; exit 1; }
gh auth status --hostname github.com >/dev/null

encode_ref() {
  local value=$1
  value=${value//%/%25}
  value=${value//\//%2F}
  printf '%s' "$value"
}

normalize_repo_path() {
  local input=${1//\\//}
  local segment joined=
  local -a segments stack=()
  IFS=/ read -r -a segments <<< "$input"
  for segment in "${segments[@]}"; do
    case $segment in
      ''|.) continue ;;
      ..)
        if [[ ${#stack[@]} -gt 0 ]]; then unset "stack[$((${#stack[@]} - 1))]"; fi
        ;;
      *) stack+=("$segment") ;;
    esac
  done
  for segment in "${stack[@]}"; do
    [[ -n $joined ]] && joined+=/
    joined+=$segment
  done
  printf '%s' "$joined"
}

get_property() {
  local name=$1 raw
  raw=$(printf '%s\n' "$PROPERTIES" | awk -v wanted="$name" '
    {
      line=$0
      sub(/^[ \t]*/, "", line)
      if (line == "" || line ~ /^[#!]/) next
      separator=index(line, "=")
      if (!separator) separator=index(line, ":")
      if (!separator) next
      key=substr(line, 1, separator - 1)
      sub(/[ \t]*$/, "", key)
      if (key != wanted) next
      value=substr(line, separator + 1)
      sub(/^[ \t]*/, "", value)
      sub(/[ \t\r]*$/, "", value)
      print value
      exit
    }')
  [[ -n $raw ]] || { echo "Missing or empty '$name' in key.properties." >&2; return 1; }

  local decoded= character next_character index
  for ((index = 0; index < ${#raw}; index++)); do
    character=${raw:index:1}
    if [[ $character == \\ && $((index + 1)) -lt ${#raw} ]]; then
      ((index += 1))
      next_character=${raw:index:1}
      case $next_character in
        t) decoded+=$'\t' ;;
        n) decoded+=$'\n' ;;
        r) decoded+=$'\r' ;;
        f) decoded+=$'\f' ;;
        *) decoded+=$next_character ;;
      esac
    else
      decoded+=$character
    fi
  done
  printf '%s' "$decoded"
}

TREE_ENDPOINT="repos/$REPOSITORY/git/trees/$(encode_ref "$BRANCH")?recursive=1"
truncated=$(gh api "$TREE_ENDPOINT" --jq '.truncated')
[[ $truncated == false ]] || { echo 'Repository tree is truncated; refusing to guess the keystore path.' >&2; exit 1; }
TREE_PATHS=$(gh api "$TREE_ENDPOINT" --jq '.tree[] | select(.type == "blob") | .path')
repo_has_path() { grep -Fxq -- "$1" <<< "$TREE_PATHS"; }

KEY_PROPERTIES_PATH=$(normalize_repo_path "$KEY_PROPERTIES_PATH")
repo_has_path "$KEY_PROPERTIES_PATH" || { echo "Could not find $KEY_PROPERTIES_PATH in $REPOSITORY at $BRANCH." >&2; exit 1; }
PROPERTIES_CONTENT=$(gh api "repos/$REPOSITORY/contents/$KEY_PROPERTIES_PATH?ref=$(encode_ref "$BRANCH")" --jq '.content' | tr -d '[:space:]')
PROPERTIES=$(printf '%s' "$PROPERTIES_CONTENT" | base64 -d)
KEY_ALIAS=$(get_property keyAlias)
KEY_PASSWORD=$(get_property keyPassword)
STORE_PASSWORD=$(get_property storePassword)
STORE_FILE=$(get_property storeFile)

if [[ -n $KEYSTORE_PATH_OVERRIDE ]]; then
  candidates=$(normalize_repo_path "$KEYSTORE_PATH_OVERRIDE")
else
  STORE_FILE=$(normalize_repo_path "$STORE_FILE")
  if [[ $STORE_FILE == android/* ]]; then
    candidates=$STORE_FILE
  else
    candidates=$(printf '%s\n' \
      "$(normalize_repo_path "android/app/$STORE_FILE")" \
      "$(normalize_repo_path "android/$STORE_FILE")" \
      "$STORE_FILE")
  fi
fi
KEYSTORE_REPO_PATH=
while IFS= read -r candidate; do
  if [[ -n $candidate ]] && repo_has_path "$candidate"; then
    KEYSTORE_REPO_PATH=$candidate
    break
  fi
done <<< "$candidates"
[[ -n $KEYSTORE_REPO_PATH ]] || {
  echo "Could not locate the keystore from storeFile. Pass --keystore-path with its repository path." >&2
  exit 1
}
KEYSTORE_BASE64=$(gh api "repos/$REPOSITORY/contents/$KEYSTORE_REPO_PATH?ref=$(encode_ref "$BRANCH")" --jq '.content' | tr -d '[:space:]')
printf '%s' "$KEYSTORE_BASE64" | base64 -d >/dev/null

if repo_has_path "$KEY_PROPERTIES_PATH" && repo_has_path "$KEYSTORE_REPO_PATH"; then
  echo 'Warning: key.properties and the keystore are committed in this repository; this script does not remove them or erase Git history.' >&2
fi

if [[ $DRY_RUN -eq 1 ]]; then
  printf 'Dry run for %s: would set ANDROID_KEYSTORE_BASE64, ANDROID_KEY_ALIAS, ANDROID_KEY_PASSWORD, ANDROID_STORE_PASSWORD. No secrets were sent.\n' "$REPOSITORY"
  exit 0
fi

read -r -p "Set four Android signing secrets in $REPOSITORY? [y/N] " confirmation
[[ $confirmation == [yY] ]] || { echo 'Cancelled; no secrets were set.'; exit 0; }

printf '%s' "$KEYSTORE_BASE64" | gh secret set ANDROID_KEYSTORE_BASE64 --repo "$REPOSITORY"
printf '%s' "$KEY_ALIAS" | gh secret set ANDROID_KEY_ALIAS --repo "$REPOSITORY"
printf '%s' "$KEY_PASSWORD" | gh secret set ANDROID_KEY_PASSWORD --repo "$REPOSITORY"
printf '%s' "$STORE_PASSWORD" | gh secret set ANDROID_STORE_PASSWORD --repo "$REPOSITORY"
echo "Android signing secrets set for $REPOSITORY. Values were not displayed."
