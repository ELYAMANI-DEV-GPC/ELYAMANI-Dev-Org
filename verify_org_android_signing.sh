#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: $0 ORG [BRANCH]" >&2
  echo "Checks all repositories in an org for Android signing files and required secret names on a target branch." >&2
  exit 2
}

ORG="${1:-}"
BRANCH="${2:-main}"

[[ -n "$ORG" ]] || usage
command -v gh >/dev/null || { echo "GitHub CLI (gh) is required." >&2; exit 1; }
gh auth status --hostname github.com >/dev/null || { echo "GitHub CLI is not authenticated. Run: gh auth login" >&2; exit 1; }

REQUIRED_SECRETS=(
  "ANDROID_KEYSTORE_BASE64"
  "ANDROID_KEY_ALIAS"
  "ANDROID_KEY_PASSWORD"
  "ANDROID_STORE_PASSWORD"
)

printf 'Checking org: %s\nBranch: %s\n\n' "$ORG" "$BRANCH"

REPOS=$(gh repo list "$ORG" --limit 200 --json nameWithOwner --jq '.[].nameWithOwner') || {
  echo "Could not list repositories for org $ORG." >&2
  exit 1
}

if [[ -z "$REPOS" ]]; then
  echo "No repositories were found in $ORG."
  exit 0
fi

for repo in $REPOS; do
  echo "=================================================="
  echo "REPO: $repo"

  TREE_JSON=$(gh api "repos/$repo/git/trees/$BRANCH?recursive=1" 2>/dev/null || true)
  if [[ -z "$TREE_JSON" ]]; then
    echo "Branch $BRANCH not found or repo inaccessible."
    echo "RESULT: FAIL"
    echo
    continue
  fi

  mapfile -t paths < <(printf '%s\n' "$TREE_JSON" | jq -r '.tree[]?.path // empty' 2>/dev/null)

  has_key_properties=0
  has_keystore=0

  for p in "${paths[@]}"; do
    if [[ "$p" == "android/key.properties" ]]; then has_key_properties=1; fi
    if [[ "$p" == "android/upload-keystore.jks" ]]; then has_keystore=1; fi
  done

  if [[ $has_key_properties -eq 1 ]]; then
    echo "FOUND: android/key.properties"
  else
    echo "MISSING: android/key.properties"
  fi

  if [[ $has_keystore -eq 1 ]]; then
    echo "FOUND: android/upload-keystore.jks"
  else
    echo "MISSING: android/upload-keystore.jks"
  fi

  SECRETS_JSON=$(gh api "repos/$repo/actions/secrets" 2>/dev/null || true)
  if [[ -n "$SECRETS_JSON" ]]; then
    mapfile -t present < <(printf '%s\n' "$SECRETS_JSON" | jq -r '.secrets[].name // empty' 2>/dev/null)
    missing=0
    for secret in "${REQUIRED_SECRETS[@]}"; do
      if printf '%s\n' "${present[@]}" | grep -Fxq "$secret"; then
        echo "SECRET OK: $secret"
      else
        echo "SECRET MISSING: $secret"
        missing=1
      fi
    done
  else
    echo "Could not read secret list for repo; permissions may be limited."
    missing=1
  fi

  if [[ $has_key_properties -eq 1 && $has_keystore -eq 1 && $missing -eq 0 ]]; then
    echo "RESULT: OK"
  else
    echo "RESULT: NEEDS ATTENTION"
  fi
  echo
 done
