#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: $0 OWNER/REPO [BRANCH]" >&2
  echo "Checks whether a repo contains its own Android signing files and whether the required GitHub Actions secrets are configured." >&2
  exit 2
}

REPO="${1:-}"
BRANCH="${2:-main}"

[[ -n "$REPO" ]] || usage
[[ "$REPO" =~ ^[^/]+/[^/]+$ ]] || { echo "Invalid repo format: $REPO" >&2; exit 2; }
command -v gh >/dev/null || { echo "GitHub CLI (gh) is required." >&2; exit 1; }
gh auth status --hostname github.com >/dev/null || { echo "GitHub CLI is not authenticated. Run: gh auth login" >&2; exit 1; }

KEY_PROPERTIES_PATH="android/key.properties"
KEYSTORE_PATH="android/upload-keystore.jks"
REQUIRED_SECRETS=(
  "ANDROID_KEYSTORE_BASE64"
  "ANDROID_KEY_ALIAS"
  "ANDROID_KEY_PASSWORD"
  "ANDROID_STORE_PASSWORD"
)

printf 'Repository: %s\nBranch: %s\n\n' "$REPO" "$BRANCH"

TREE_JSON=$(gh api "repos/$REPO/git/trees/$BRANCH?recursive=1" 2>/dev/null) || {
  echo "Could not read repository tree for $REPO on branch $BRANCH." >&2
  exit 1
}

mapfile -t TREE_PATHS < <(printf '%s\n' "$TREE_JSON" | jq -r '.tree[]?.path // empty' 2>/dev/null)

has_key_properties=0
has_keystore=0

for p in "${TREE_PATHS[@]}"; do
  if [[ "$p" == "$KEY_PROPERTIES_PATH" ]]; then has_key_properties=1; fi
  if [[ "$p" == "$KEYSTORE_PATH" ]]; then has_keystore=1; fi
done

if [[ $has_key_properties -eq 1 ]]; then
  echo "FOUND: $KEY_PROPERTIES_PATH"
else
  echo "MISSING: $KEY_PROPERTIES_PATH"
fi

if [[ $has_keystore -eq 1 ]]; then
  echo "FOUND: $KEYSTORE_PATH"
else
  echo "MISSING: $KEYSTORE_PATH"
fi

if [[ $has_key_properties -eq 1 ]]; then
  printf '\nContents of %s:\n' "$KEY_PROPERTIES_PATH"
  gh api "repos/$REPO/contents/$KEY_PROPERTIES_PATH?ref=$BRANCH" --jq '.content' 2>/dev/null | base64 -d 2>/dev/null || echo "Unable to decode $KEY_PROPERTIES_PATH"
  printf '\n'
fi

printf '\nChecking repo secrets...\n'
SECRETS_JSON=$(gh api "repos/$REPO/actions/secrets" 2>/dev/null || true)
if [[ -n "$SECRETS_JSON" ]]; then
  mapfile -t PRESENT < <(printf '%s\n' "$SECRETS_JSON" | jq -r '.secrets[].name // empty' 2>/dev/null)
  for secret in "${REQUIRED_SECRETS[@]}"; do
    if printf '%s\n' "${PRESENT[@]}" | grep -Fxq "$secret"; then
      echo "SECRET OK: $secret"
    else
      echo "SECRET MISSING: $secret"
    fi
  done
else
  echo "Could not read repo secrets list. Check GH access or repo permissions."
fi

if [[ $has_key_properties -eq 1 && $has_keystore -eq 1 ]]; then
  echo "\nVerdict: repo likely uses its own Android signing files from branch $BRANCH."
else
  echo "\nVerdict: repo does not appear to contain its own Android signing files on branch $BRANCH."
fi

if printf '%s\n' "${TREE_PATHS[@]}" 2>/dev/null | grep -Fxq "$KEY_PROPERTIES_PATH" && printf '%s\n' "${TREE_PATHS[@]}" 2>/dev/null | grep -Fxq "$KEYSTORE_PATH"; then
  exit 0
else
  exit 1
fi
