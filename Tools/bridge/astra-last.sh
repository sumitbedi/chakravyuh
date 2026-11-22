#!/bin/bash
# Prints Astra's latest reply (and whether Astra is still working).
set -euo pipefail
source "$(dirname "$0")/config.sh"
[ -n "$ASTRA_THREAD" ] || { echo "No Astra chat thread set: put its id in Tools/bridge/astra-thread" >&2; exit 1; }
f=$(ls -t ~/.codex/sessions/*/*/*/rollout-*"$ASTRA_THREAD".jsonl | head -1)
python3 - "$f" <<'PY'
import sys, json
last, busy = None, False
for line in open(sys.argv[1]):
    try: o = json.loads(line)
    except Exception: continue
    p = o.get("payload") or {}
    if p.get("type") == "task_started": busy = True
    if p.get("type") == "task_complete": busy = False; last = p.get("last_agent_message") or last
print("Astra is still working…" if busy else "Astra is idle.")
print("\nLatest reply:\n" + (last or "(none)"))
PY
