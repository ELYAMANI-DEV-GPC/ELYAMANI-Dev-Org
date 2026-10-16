#!/usr/bin/env bash
set -euo pipefail

REPO="${1:-ELYAMANI-DEV-GPC/68d9d1251299230338fbec29}"
BRANCH="${2:-main}"
KEY_PROPERTIES="${3:-android/key.properties}"
KEYSTORE="${4:-android/upload-keystore.jks}"
PLAY_JSON_KEY="${5:-}"

echo "Repo: $REPO"
echo "Branch: $BRANCH"
echo "Using key properties: $KEY_PROPERTIES"
echo "Using keystore: $KEYSTORE"

if ! command -v gh >/dev/null 2>&1; then
  echo "ERROR: GitHub CLI (gh) is required."
  exit 1
fi

if ! gh auth status --hostname github.com >/dev/null 2>&1; then
  echo "ERROR: gh is not authenticated. Run: gh auth login"
  exit 1
fi

read_prop() {
  local file="$1"
  local name="$2"
  awk -F= -v n="$name" 'BEGIN{IGNORECASE=1} $1==n { sub(/^[^=]*=/, "", $0); sub(/\r$/, "", $0); print; exit }' "$file"
}

if [[ ! -f "$KEY_PROPERTIES" ]]; then
  echo "ERROR: missing $KEY_PROPERTIES"
  exit 1
fi

if [[ ! -f "$KEYSTORE" ]]; then
  echo "ERROR: missing $KEYSTORE"
  exit 1
fi

KEY_ALIAS="$(read_prop "$KEY_PROPERTIES" keyAlias || true)"
KEY_PASSWORD="$(read_prop "$KEY_PROPERTIES" keyPassword || true)"
STORE_PASSWORD="$(read_prop "$KEY_PROPERTIES" storePassword || true)"
STORE_FILE="$(read_prop "$KEY_PROPERTIES" storeFile || true)"

if [[ -z "$KEY_ALIAS" || -z "$KEY_PASSWORD" || -z "$STORE_PASSWORD" ]]; then
  echo "ERROR: key.properties must contain keyAlias, keyPassword, and storePassword"
  exit 1
fi

KEYSTORE_B64=$(base64 -i "$KEYSTORE" | tr -d '\n')

printf '%s' "$KEYSTORE_B64" | gh secret set ANDROID_KEYSTORE_BASE64 --repo "$REPO"
printf '%s' "$KEY_ALIAS" | gh secret set ANDROID_KEY_ALIAS --repo "$REPO"
printf '%s' "$KEY_PASSWORD" | gh secret set ANDROID_KEY_PASSWORD --repo "$REPO"
printf '%s' "$STORE_PASSWORD" | gh secret set ANDROID_STORE_PASSWORD --repo "$REPO"

if [[ -n "$PLAY_JSON_KEY" ]]; then
  if [[ ! -f "$PLAY_JSON_KEY" ]]; then
    echo "ERROR: missing $PLAY_JSON_KEY"
    exit 1
  fi
  printf '%s' "$(cat "$PLAY_JSON_KEY")" | gh secret set PLAY_STORE_JSON_KEY --repo "$REPO"
fi

echo "Secrets updated for $REPO"
