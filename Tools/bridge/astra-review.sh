#!/bin/bash
# Independent, read-only review; never resumes the implementation session.
set -uo pipefail
source "$(dirname "$0")/config.sh"
usage() {
  echo 'usage: astra-review.sh [--base BRANCH] [--adversarial] [--effort low|medium|high|xhigh|max|ultra]' >&2
  echo 'Default base: HEAD (current staged/unstaged diff). Help/invalid arguments exit 2.' >&2
  exit 2
}
base=HEAD; kind=review; effort=high
while [ $# -gt 0 ]; do
  case "$1" in
    --base|--effort)
      [ $# -ge 2 ] && [ -n "$2" ] && [[ "$2" != -* ]] || usage
      case "$1" in --base) base="$2";; --effort) effort="$2";; esac
      shift 2;;
    --adversarial) kind=adversarial; shift;;
    *) usage;;
  esac
done
case "$effort" in low|medium|high|xhigh|max|ultra) ;; *) usage;; esac
bridge_run "$kind" review "$effort" "" 50000000 1 0 0 "$base" ""
