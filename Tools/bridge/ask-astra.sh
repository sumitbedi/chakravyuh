#!/bin/bash
# Claude -> Astra and back, in one step: sends the message, waits for Astra to finish,
# prints Astra's reply. Usage: Tools/bridge/ask-astra.sh "message"
# Goes into Astra's chat thread (Sumit sees it in the ChatGPT app). The app runs these turns
# read-only, so use astra-do.sh for anything that changes files.
set -euo pipefail
source "$(dirname "$0")/config.sh"
[ -n "$ASTRA_THREAD" ] || { echo "No Astra chat thread set: put its id in Tools/bridge/astra-thread" >&2; exit 1; }
[ $# -ge 1 ] || { echo "usage: ask-astra.sh \"message\"" >&2; exit 1; }
f=$(ls -t ~/.codex/sessions/*/*/*/rollout-*"$ASTRA_THREAD".jsonl | head -1)
offset=$(stat -f %z "$f")
"$CODEX" queue --thread "$ASTRA_THREAD" -c model_reasoning_effort="high" --message "[From Claude, via the bridge] $*" < /dev/null >/dev/null
exec python3 - "$f" "$offset" <<'PY'
import sys, json, time
path, pos, deadline = sys.argv[1], int(sys.argv[2]), time.time() + 1800
buf = ""
while time.time() < deadline:
    with open(path) as fh:
        fh.seek(pos); chunk = fh.read(); pos = fh.tell()
    buf += chunk
    *lines, buf = buf.split("\n")
    for line in lines:
        try: p = json.loads(line).get("payload") or {}
        except Exception: continue
        if p.get("type") == "task_complete":
            print(p.get("last_agent_message") or "(Astra finished with no message)"); sys.exit(0)
    time.sleep(0.5)
print("No reply from Astra within 30 minutes.", file=sys.stderr); sys.exit(1)
PY
