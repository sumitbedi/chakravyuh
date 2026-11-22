#!/bin/bash
# Headless bridge jobs. Default cap: 50M input tokens; ultra runs only when Sumit asks for it.
# --art keeps plugins/apps (image_gen dependencies) enabled while browser stays off.
# Concept-ad callers: cd to the concept folder, then replace bare codex with
# /absolute/path/to/astra-do.sh --art --topic <concept> and a self-contained task.
set -uo pipefail
source "$(dirname "$0")/config.sh"
usage() {
  cat >&2 <<'USAGE'
usage: astra-do.sh [--effort low|medium|high|xhigh|max|ultra] [--topic NAME] [--fresh]
                   [--cap TOKENS] [--model MODEL] [--browser | --art]
                   [--research | --web] [--] "task"
Default: high effort, 50M input cap, model from Codex config, fresh session.
--topic resumes one workstream; --fresh retires its previous session.
--art enables image-generation dependencies, disables browser, defaults topic to art.
Art runs in the caller's current folder; other jobs run in the bridge repository.
Artifacts: bridge-inbox/runs/<job-id>/{reply.txt,status,usage,events.jsonl,stderr.log}.
Help/invalid arguments exit 2; a busy topic exits 3. Ultra only when Sumit asks: it spawns helpers the cap does not count.
USAGE
  exit 2
}
effort=high; topic=""; fresh=0; cap=50000000; cap_set=0; browser=0; web=0; model=""; kind=work
while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help) usage;;
    --effort|--topic|--cap|--model)
      [ $# -ge 2 ] && [ -n "$2" ] && [[ "$2" != -* ]] || usage
      case "$1" in
        --effort) effort="$2";; --topic) topic="$2";;
        --cap) cap="$2"; cap_set=1;; --model) model="$2";;
      esac
      shift 2;;
    --fresh) fresh=1; shift;;
    --browser) browser=1; shift;;
    --art) kind=art; shift;;
    --research|--web) web=1; shift;;
    --) shift; break;;
    -*) usage;;
    *) break;;
  esac
done
[ $# -eq 1 ] && [ -n "$1" ] || usage
case "$effort" in low|medium|high|xhigh|max|ultra) ;; *) usage;; esac
[[ "$cap" =~ ^[1-9][0-9]*$ ]] || usage
if [ -n "$topic" ]; then
  [[ "$topic" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || usage
fi
if [ "$kind" = art ]; then
  [ "$browser" = 0 ] || usage
  topic="${topic:-art}"
fi
[ "$browser" = 1 ] && [ "$cap_set" = 0 ] && cap=60000000
bridge_run "$kind" "$topic" "$effort" "$model" "$cap" "$fresh" "$browser" "$web" "" "$1"
