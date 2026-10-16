#!/usr/bin/env bash
set -euo pipefail

ORG="${1:-ELYAMANI-DEV-GPC}"
WORKFLOW_FILE="${2:-.github/workflows/flutter-build.yml}"

export PATH="$HOME/bin:$PATH"

command -v gh >/dev/null || { echo "GitHub CLI (gh) is required." >&2; exit 1; }
gh auth status --hostname github.com >/dev/null || { echo "GitHub CLI is not authenticated." >&2; exit 1; }
[[ -f "$WORKFLOW_FILE" ]] || { echo "Workflow file not found: $WORKFLOW_FILE" >&2; exit 1; }

CONTENT_B64=$(base64 -i "$WORKFLOW_FILE" | tr -d '\n')

echo "Pushing $WORKFLOW_FILE to all app repos in $ORG"
echo

gh repo list "$ORG" --limit 200 --json nameWithOwner,defaultBranchRef --jq '.[] | .nameWithOwner + " " + .defaultBranchRef.name' | while read -r REPO BRANCH; do
  echo "=================================================="
  echo "REPO: $REPO (branch: $BRANCH)"

  if [[ "$REPO" == *"/privacy-policies" || "$REPO" == *"/voice-changer-app" || "$REPO" == *"/ELYAMANI-Dev-Org" ]]; then
    echo "SKIP: not an app repo"
    echo
    continue
  fi

  # Only push to repos that look like Flutter apps (have pubspec.yaml and android/)
  TREE_JSON=$(gh api "repos/$REPO/git/trees/$BRANCH?recursive=1" 2>/dev/null || true)
  if [[ -z "$TREE_JSON" ]]; then
    echo "FAIL: could not read tree"
    echo
    continue
  fi

  if ! printf '%s\n' "$TREE_JSON" | jq -r '.tree[]?.path // empty' | grep -q '^pubspec.yaml$'; then
    echo "SKIP: not a Flutter app (no pubspec.yaml)"
    echo
    continue
  fi

  # Skip if workflow already exists with same content
  EXISTING=$(gh api "repos/$REPO/contents/.github/workflows/flutter-build.yml?ref=$BRANCH" --jq '.content' 2>/dev/null | tr -d '[:space:]' || true)
  if [[ -n "$EXISTING" && "$EXISTING" == "$CONTENT_B64" ]]; then
    echo "OK: workflow already up to date"
    echo
    continue
  fi

  SHA=$(gh api "repos/$REPO/contents/.github/workflows/flutter-build.yml?ref=$BRANCH" --jq '.sha' 2>/dev/null || true)

  if [[ -n "$SHA" ]]; then
    gh api "repos/$REPO/contents/.github/workflows/flutter-build.yml" -X PUT \
      -f message="Update Flutter build workflow [skip ci]" \
      -f content="$CONTENT_B64" \
      -f branch="$BRANCH" \
      -f sha="$SHA" >/dev/null
    echo "UPDATED: workflow updated"
  else
    gh api "repos/$REPO/contents/.github/workflows/flutter-build.yml" -X PUT \
      -f message="Add Flutter build workflow [skip ci]" \
      -f content="$CONTENT_B64" \
      -f branch="$BRANCH" >/dev/null
    echo "ADDED: workflow added"
  fi
  echo
done

echo "Done."
