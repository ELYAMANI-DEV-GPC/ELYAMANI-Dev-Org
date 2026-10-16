#!/usr/bin/env bash
set -euo pipefail

REPO="${1:-ELYAMANI-DEV-GPC/68d9d1251299230338fbec29}"
BRANCH="${2:-main}"

printf 'Setting up Android signing secrets for %s on %s\n' "$REPO" "$BRANCH"

cd "$(dirname "$0")"

# This script assumes the repo already contains:
#   android/key.properties
#   android/upload-keystore.jks
# and that gh is authenticated with enough permissions.

bash ./sync-android-signing-secrets.sh "$REPO" "$BRANCH" android/key.properties --yes

echo 'Done. The repo now has the expected Android signing secrets.'
