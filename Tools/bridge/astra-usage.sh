#!/bin/bash
# Read quota telemetry only. Never reads auth.json or invokes Codex.
set -uo pipefail
python3 - <<'PY'
import datetime, json, os
from pathlib import Path

# Walk backwards in bounded chunks; a large rollout is never loaded in memory.
def reverse_lines(path):
    with path.open('rb') as stream:
        stream.seek(0, 2)
        pos, pending = stream.tell(), b''
        while pos:
            size = min(pos, 65536)
            pos -= size
            stream.seek(pos)
            parts = (stream.read(size) + pending).split(b'\n')
            pending = parts[0]
            yield from reversed(parts[1:])
        if pending:
            yield pending

root = Path(os.environ.get('CODEX_HOME', str(Path.home() / '.codex'))) / 'sessions'
try:
    latest = max(root.rglob('rollout-*.jsonl'), key=lambda p: p.stat().st_mtime_ns, default=None)
    if latest:
        for line in reverse_lines(latest):
            if b'"rate_limits"' not in line:
                continue
            try:
                limits = (json.loads(line).get('payload') or {}).get('rate_limits') or {}
                primary = limits.get('primary') or {}
                if primary.get('used_percent') is None:
                    continue
                reset = primary.get('resets_at')
                local = datetime.datetime.fromtimestamp(float(reset)).astimezone().strftime('%Y-%m-%dT%H:%M:%S%z') if reset is not None else 'unknown'
                print('[quota] weekly used_percent=%s window=%smin resets_at=%s plan_type=%s' % (
                    primary['used_percent'], primary.get('window_minutes', 'unknown'), local,
                    limits.get('plan_type') or 'unknown'))
                break
            except (ValueError, TypeError, KeyError, OverflowError, OSError):
                continue
        else:
            print('[quota] weekly unavailable (no rate_limits.primary in newest rollout)')
    else:
        print('[quota] weekly unavailable (no rollout)')
except OSError:
    print('[quota] weekly unavailable (rollout unreadable)')
PY
