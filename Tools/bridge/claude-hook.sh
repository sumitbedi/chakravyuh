#!/bin/bash
# Claude Code hook (UserPromptSubmit + SessionStart). Shows Claude unread notes from Astra
# and any new HANDOFF.md entry Astra wrote since Claude last looked.
source "$(dirname "$0")/config.sh"
state="$REPO/bridge-inbox/.claude-seen-handoff"
out=""
if [ -s "$INBOX" ]; then
  out+=$'Unread notes from Astra:\n'"$(cat "$INBOX")"$'\n'
  mkdir -p "$REPO/bridge-inbox"; cat "$INBOX" >> "$REPO/bridge-inbox/for-claude.read.md"; : > "$INBOX"
fi
top=$(grep -m1 '^## ' "$REPO/HANDOFF.md" 2>/dev/null)
if [[ "$top" == *Astra* ]] && [ "$top" != "$(cat "$state" 2>/dev/null)" ]; then
  out+=$'\nNew HANDOFF.md entry from Astra:\n'"$(awk '/^## /{n++} n==1' "$REPO/HANDOFF.md")"$'\n'
  mkdir -p "$REPO/bridge-inbox"; echo "$top" > "$state"
fi
[ -n "$out" ] && printf '[Agent bridge]\n%s' "$out"
exit 0
