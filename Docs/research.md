# Chakravyuh: replayability research

22 November 2026. Research only; recommendations require Sumit's product approval. These examples establish precedent, not demand for Chakravyuh's new features. No user interviews or retention measurements were supplied.

## What the hits teach

- **Stack:** one tap, visible height, and overhang shaved away make progress and error legible. Perfect streaks restore width; particles and falling offcuts make precision satisfying. This is recoverable deterioration rather than arbitrary difficulty. [Contemporary hands-on review](https://macsources.com/stack-ios-game-review-by-ketchapp-and-kchlab/).
- **Helix Jump:** dangerous red platforms create readable failure; fast uninterrupted falls earn a fireball that breaks hazards. Its publisher explicitly presents the choice between speed and waiting. Precision earns power, not merely text saying “perfect.” [Voodoo](https://voodoo.io/games/helix-jump).
- **Crossy Road:** endless distance, varied traffic, cosmetic characters, coin sounds, and funny deaths give both immediate and longer goals. One review reports restarting in under a second. Escaping traffic narrowly creates an understandable “I nearly lost” moment. [Official description](https://www.crossyroad.com/), [hands-on account](https://www.techradar.com/computing/websites-apps/crossy-road).
- **Flappy Bird:** one input and one more pipe make improvement concrete; tiny mistakes explain failure. A ramp is optional: the original has constant difficulty, according to this [game-analysis paper](https://cdn.aaai.org/ojs/12846/12846-52-16362-1-2-20201228.pdf). Nguyen intended play lasting a few minutes. [Creator interview](https://tollbit.forbes.com/sites/lananhnguyen/2014/02/11/exclusive-flappy-bird-creator-dong-nguyen-says-app-gone-forever-because-it-was-an-addictive-product).
- **Subway Surfers:** three-mission sets increase the persistent score multiplier, giving each attempt a second purpose beyond survival. It illustrates progression layered over a simple run, rather than evidence that Chakravyuh needs more systems. [SYBO support](https://sybo.helpshift.com/hc/en/5-subway-surfers/faq/143-missions/).

**Synthesis, not causal proof:** short attempts, immediate score feedback, recoverable near-failures, and quick restarts plausibly support replay. Sources do not establish comparable average session lengths. For Chakravyuh, test 20–45-second early mazes and 1–3-minute runs; these are proposed targets, not industry benchmarks.

## Direct precedents

[Memory Maze, natearasti/prmncr](https://arasti.itch.io/memory-maze) explicitly combines map study, timed first-person recall, procedural layouts, and consecutive-maze Arcade mode. [Memory Maze by Stas](https://stasbri.itch.io/memory-maze) has timed study, first-person navigation, adjustable size/study time/view distance, and an optional best-route overlay during study. Useful patterns: separate learning from execution, allow rehearsal, then chain challenges. Neither page provides retention evidence; “worked” here means implemented mechanics, not proven commercial success. Their cognitive-benefit claims are unverified.

## Ranked changes: each under 30 minutes

Estimates assume existing `src/main.js` state, BFS, HUD, and overlays; integration/phone QA is additional. Independent scope estimates, not a promise to build all ten together.

1. **Remove AI waiting (25m):** enable Next immediately with local fallback; apply an arriving AI result only to its intended future level, never replace an active maze.
2. **Comparable run score (20m):** bank 100 per clear plus remaining-time bonus; save run best. Existing per-level times compare different random layouts unfairly.
3. **Clean-clear combo (20m):** no-peek clears raise multiplier to ×3; peeking resets it, but preserves banked points. Display the rule before play.
4. **Controlled ramp (20m):** two small opening mazes; increase size OR reduce study time per clear, with caps. Avoid simultaneously worsening fog and adding threats.
5. **Action sound (20m):** Web Audio step/bump/peek/clear tones; rising combo notes. Unlock audio on Start; provide mute and visual equivalents.
6. **Peek consequence (10m):** immediately flash “+5s”; retain orientation marker. Explain whether run countdown also loses five seconds.
7. **Readable pursuer (25m):** represent the monster as a countdown activated after study; heartbeat and visible warning accelerate. No pathfinding or monster model in this scope.
8. **Clutch escape (10m):** clearing with under three seconds left triggers a brief “Narrow escape!” pulse; no bonus for deliberately waiting.
9. **Fast retry (20m):** one tap resets the run, timers, overlays, and input; restore a small opening maze without reloading.
10. **Learn from failure (25m):** retain visited tiles; show walked route against BFS route after loss, with one actionable tip and Retry.

## Three-minute demo

1. **0:00–0:20, user/problem:** frame a quick spatial-memory challenge for phone puzzle players; describe demand as a hypothesis.
2. **0:20–1:10, works:** open public URL on a phone; study, navigate, peek, escape.
3. **1:10–1:45, product:** demonstrate streak and immediate retry; explain the single risk/reward rule.
4. **1:45–2:30, AI:** show actual stats → generated maze/coaching → reachability validation. Identify local fallback honestly.
5. **2:30–3:00, proof:** invite a judge to try; keep a tested small maze ready. Claude should verify touch at 390px, restart, mute, and API failure before presenting.
