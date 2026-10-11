#!/usr/bin/env bash
# Acceptance demo: Claude Code, Cursor, and Augment Code sharing local memory.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export AI_CONTEXT_HOME="${AI_CONTEXT_HOME:-$(mktemp -d /tmp/shared-context-accept-XXXXXX)}"

if [[ ! -f "$ROOT/dist/cli/index.js" ]]; then
  echo "Building…"
  (cd "$ROOT" && npm run build)
fi

ctx() {
  node "$ROOT/dist/cli/index.js" --home "$AI_CONTEXT_HOME" "$@"
}

echo "== home $AI_CONTEXT_HOME"

echo "== init"
ctx init
ctx doctor

echo "== register issuer-ui"
ctx project add issuer-ui --name "Issuer UI" --repo "$ROOT"
ctx project list

echo "== Claude Code: save a discovery"
ctx memory save --kind discovery --project issuer-ui \
  --title "PKCE required" \
  --body "Public clients must send a PKCE code_challenge on authorize." \
  --source claude-code

echo "== Cursor: retrieve the discovery"
cursor_view="$(ctx memory search PKCE --project issuer-ui)"
echo "$cursor_view"
echo "$cursor_view" | grep -q "PKCE required"

echo "== Augment: save a decision"
ctx memory save --kind decision --project issuer-ui \
  --title "S256 only" \
  --body "Reject plain PKCE; require S256." \
  --source augment

echo "== Claude Code: retrieve the decision"
claude_view="$(ctx memory search S256 --project issuer-ui)"
echo "$claude_view"
echo "$claude_view" | grep -q "S256 only"

echo "== Cursor: update current work"
ctx work update --project issuer-ui --source cursor \
  --body "Adding PKCE and state to the authorize request."
ctx work show --project issuer-ui

echo "== generate concise global stand-up"
ctx standup update --from-current-work
ctx standup show | grep -q "issuer-ui"

echo "== markdown files"
test -f "$AI_CONTEXT_HOME/standup.md"
grep -q "PKCE required" "$AI_CONTEXT_HOME/projects/issuer-ui/discoveries.md"
grep -q "S256 only" "$AI_CONTEXT_HOME/projects/issuer-ui/decisions.md"
grep -q "Adding PKCE" "$AI_CONTEXT_HOME/projects/issuer-ui/current-work.md"
echo "markdown ok"

echo "== restart persistence (new process)"
ctx memory search PKCE --project issuer-ui | grep -q "PKCE required"
ctx standup show | grep -q "issuer-ui"
ctx doctor | grep -q '"healthy": true'

echo "ACCEPTANCE PASSED"
echo "AI_CONTEXT_HOME=$AI_CONTEXT_HOME"
