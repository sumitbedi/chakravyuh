#!/bin/bash
# Astra -> Claude. Leaves a note Claude reads automatically at the start of its next turn.
# Usage: Tools/bridge/tell-claude.sh "message"
set -euo pipefail
source "$(dirname "$0")/config.sh"
[ $# -ge 1 ] || { echo "usage: tell-claude.sh \"message\"" >&2; exit 1; }
mkdir -p "$(dirname "$INBOX")"
printf '\n### %s · from Astra\n%s\n' "$(date '+%Y-%m-%d %H:%M')" "$*" >> "$INBOX"
echo "Left for Claude in bridge-inbox/for-claude.md"
