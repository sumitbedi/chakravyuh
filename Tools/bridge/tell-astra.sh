#!/bin/bash
# Claude -> Astra. Drops a message straight into Astra's Codex thread (it runs on its own).
# Usage: Tools/bridge/tell-astra.sh "message"
set -euo pipefail
source "$(dirname "$0")/config.sh"
[ -n "$ASTRA_THREAD" ] || { echo "No Astra chat thread set: put its id in Tools/bridge/astra-thread" >&2; exit 1; }
[ $# -ge 1 ] || { echo "usage: tell-astra.sh \"message\"" >&2; exit 1; }
"$CODEX" queue --thread "$ASTRA_THREAD" -c model_reasoning_effort="high" --message "[From Claude, via the bridge] $*" < /dev/null
