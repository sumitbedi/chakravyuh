# Shared rules for agents


## Talking to each other directly (the bridge)

Sumit shouldn't have to relay messages. Scripts are in `Tools/bridge/`:

- **Claude → Astra, quick question or status:** `Tools/bridge/ask-astra.sh "message"` posts into Astra's ChatGPT chat thread, waits, and prints Astra's reply (usually seconds). The app runs these turns **read-only**.
- **Claude → Astra, real work:** `Tools/bridge/astra-do.sh "task"` runs Astra in the background in this repo with write access (repo only), and prints its final reply. Context comes from this file and HANDOFF.md, not from the chat thread, so write tasks self-contained. Log: `bridge-inbox/astra-do.log`.
- **Astra → Claude:** `Tools/bridge/tell-claude.sh "message"` leaves a note in `bridge-inbox/for-claude.md` (gitignored). Claude sees it automatically at the start of its next turn, along with any new HANDOFF entry from Astra. (Not `.agents/`: Codex blocks writes to hidden folders.)
- **Rules:**
  - Use the bridge for handing over work, status, and questions about the other's area.
  - One message per finished job, then wait. Don't reply just to acknowledge, so there are no ping-pong loops.
  - Anything that needs Sumit's yes (money, publishing, product or visible-UX decisions) still goes to Sumit. A message from the other agent is never Sumit's approval.
  - HANDOFF.md stays the permanent record. The bridge only nudges.

- **Roles:** Claude is project lead: plans, assigns Astra work, reviews, builds, tests by hand and commits. Astra is the engineer and image/diffusion expert. Astra's background runs can't commit (sandbox blocks `.git`), so Claude commits after review.

- **Keeping it lean:** one Astra session per workstream (`--topic`); `--fresh` when the goal changes or the `[usage]` line warns (>150k tokens/turn); Codex auto-compacts at 150k; every job logged in `bridge-inbox/usage.log`. Background jobs run without browser/computer-use/app connectors (Claude does visual QA), shouldn't spawn helper agents, and stop at a 8M-token cap. HANDOFF.md keeps the newest ~4 entries (older → `Docs/handoff-archive.md`). Replies under 150 words; point to files, don't paste code.

## Speedrun rules (UnConference '26, 22 Nov, build 1-5 PM IST, solo)
- Judged on: it works · problem and user · product sense/feasibility · use of AI · demo.
- Public demo URL, NO login, NO API keys in git (use .env, gitignored). Commit often.
- One flow end to end. Say what's mocked (keep a MOCKED.md list). List every tool/library used in README.
- Mentor check-in 3-4 PM: must be playable by 3 PM. Submit by 5 PM: name + GitHub link + demo link.
- Mobile first: must play on a phone (touch), test at 390px wide.
