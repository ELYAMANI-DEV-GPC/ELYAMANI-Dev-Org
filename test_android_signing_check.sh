#!/usr/bin/env bash
set -euo pipefail

REPO="${1:-ELYAMANI-DEV-GPC/68d9d1251299230338fbec29}"
BRANCH="${2:-main}"

printf 'Testing Android signing setup for %s on %s\n\n' "$REPO" "$BRANCH"

if ! command -v gh >/dev/null 2>&1; then
  echo "FAIL: gh is not installed"
  exit 1
fi

if ! gh auth status --hostname github.com >/dev/null 2>&1; then
  echo "FAIL: gh is not authenticated"
  exit 1
fi

TREE_JSON=$(gh api "repos/$REPO/git/trees/$BRANCH?recursive=1" 2>/dev/null || true)
if [[ -z "$TREE_JSON" ]]; then
  echo "FAIL: cannot read repo tree for $REPO on $BRANCH"
  exit 1
fi

mapfile -t PATHS < <(printf '%s\n' "$TREE_JSON" | jq -r '.tree[]?.path // empty' 2>/dev/null)

HAS_KEY_PROPERTIES=0
HAS_KEYSTORE=0
for p in "${PATHS[@]}"; do
  [[ "$p" == "android/key.properties" ]] && HAS_KEY_PROPERTIES=1
  [[ "$p" == "android/upload-keystore.jks" ]] && HAS_KEYSTORE=1
 done

if [[ $HAS_KEY_PROPERTIES -eq 1 ]]; then
  echo "PASS: android/key.properties exists"
else
  echo "FAIL: android/key.properties missing"
fi

if [[ $HAS_KEYSTORE -eq 1 ]]; then
  echo "PASS: android/upload-keystore.jks exists"
else
  echo "FAIL: android/upload-keystore.jks missing"
fi

SECRETS_JSON=$(gh api "repos/$REPO/actions/secrets" 2>/dev/null || true)
if [[ -z "$SECRETS_JSON" ]]; then
  echo "FAIL: cannot read repo actions secrets"
  exit 1
fi

mapfile -t SECRET_NAMES < <(printf '%s\n' "$SECRETS_JSON" | jq -r '.secrets[].name // empty' 2>/dev/null)
for name in ANDROID_KEYSTORE_BASE64 ANDROID_KEY_ALIAS ANDROID_KEY_PASSWORD ANDROID_STORE_PASSWORD; do
  if printf '%s\n' "${SECRET_NAMES[@]}" | grep -Fxq "$name"; then
    echo "PASS: secret exists -> $name"
  else
    echo "FAIL: secret missing -> $name"
  fi
done

if [[ $HAS_KEY_PROPERTIES -eq 1 && $HAS_KEYSTORE -eq 1 ]]; then
  echo "\nResult: repo has its own signing files on $BRANCH"
else
  echo "\nResult: repo does NOT have its own signing files on $BRANCH"
fi
