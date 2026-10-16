#!/usr/bin/env bash
set -euo pipefail

ORG="${1:-ELYAMANI-DEV-GPC}"
BRANCH="${2:-main}"
PLAY_JSON_PATH="${3:-}"

export PATH="$HOME/bin:$PATH"

echo "Applying Android signing secrets to all repos in org: $ORG"
echo "Branch: $BRANCH"
if [[ -n "$PLAY_JSON_PATH" ]]; then
  echo "Play JSON: $PLAY_JSON_PATH"
fi
echo

command -v gh >/dev/null || { echo "GitHub CLI (gh) is required." >&2; exit 1; }
gh auth status --hostname github.com >/dev/null || { echo "GitHub CLI is not authenticated." >&2; exit 1; }

find_key_properties() {
  printf '%s\n' "$1" | jq -r '.tree[]?.path // empty' | grep -E '(^|/)android/key\.properties$' | head -n 1 || true
}

find_keystore() {
  printf '%s\n' "$1" | jq -r '.tree[]?.path // empty' | grep -E '(^android/app/|(^|/)android/|\.jks$|\.keystore$)' | grep -E '\.(jks|keystore)$' | head -n 1 || true
}

gh repo list "$ORG" --limit 200 --json nameWithOwner --jq '.[].nameWithOwner' | while read -r REPO; do
  echo "=================================================="
  echo "REPO: $REPO"

  if [[ "$REPO" == *"/privacy-policies" || "$REPO" == *"/voice-changer-app" || "$REPO" == *"/ELYAMANI-Dev-Org" ]]; then
    echo "SKIP: not an app repo"
    echo
    continue
  fi

  TREE_JSON=$(gh api "repos/$REPO/git/trees/$BRANCH?recursive=1" 2>/dev/null || true)
  if [[ -z "$TREE_JSON" ]]; then
    echo "FAIL: could not read tree"
    echo
    continue
  fi

  KEY_PROPERTIES_PATH=$(find_key_properties "$TREE_JSON")
  KEYSTORE_PATH=$(find_keystore "$TREE_JSON")

  if [[ -z "$KEY_PROPERTIES_PATH" ]]; then
    echo "SKIP: missing key.properties"
    echo
    continue
  fi

  if [[ -z "$KEYSTORE_PATH" ]]; then
    echo "SKIP: missing keystore"
    echo
    continue
  fi

  KEY_ALIAS=$(gh api "repos/$REPO/contents/$KEY_PROPERTIES_PATH?ref=$BRANCH" --jq '.content' 2>/dev/null | base64 -d 2>/dev/null | awk -F= '/^keyAlias=/{print $2; exit}')
  KEY_PASSWORD=$(gh api "repos/$REPO/contents/$KEY_PROPERTIES_PATH?ref=$BRANCH" --jq '.content' 2>/dev/null | base64 -d 2>/dev/null | awk -F= '/^keyPassword=/{print $2; exit}')
  STORE_PASSWORD=$(gh api "repos/$REPO/contents/$KEY_PROPERTIES_PATH?ref=$BRANCH" --jq '.content' 2>/dev/null | base64 -d 2>/dev/null | awk -F= '/^storePassword=/{print $2; exit}')

  if [[ -z "$KEY_ALIAS" || -z "$KEY_PASSWORD" || -z "$STORE_PASSWORD" ]]; then
    echo "FAIL: missing alias or passwords in $KEY_PROPERTIES_PATH"
    echo
    continue
  fi

  KEYSTORE_B64=$(gh api "repos/$REPO/contents/$KEYSTORE_PATH?ref=$BRANCH" --jq '.content' 2>/dev/null | base64 -d 2>/dev/null | base64 | tr -d '\n')

  printf '%s' "$KEYSTORE_B64" | gh secret set ANDROID_KEYSTORE_BASE64 --repo "$REPO"
  printf '%s' "$KEY_ALIAS" | gh secret set ANDROID_KEY_ALIAS --repo "$REPO"
  printf '%s' "$KEY_PASSWORD" | gh secret set ANDROID_KEY_PASSWORD --repo "$REPO"
  printf '%s' "$STORE_PASSWORD" | gh secret set ANDROID_STORE_PASSWORD --repo "$REPO"

  if [[ -n "$PLAY_JSON_PATH" ]]; then
    if [[ ! -f "$PLAY_JSON_PATH" ]]; then
      echo "FAIL: Play JSON file not found: $PLAY_JSON_PATH"
      echo
      continue
    fi
    printf '%s' "$(cat "$PLAY_JSON_PATH")" | gh secret set PLAY_STORE_JSON_KEY --repo "$REPO"
    echo "PLAY_STORE_JSON_KEY set"
  fi

  echo "DONE: secrets set for $REPO"
  echo
done
