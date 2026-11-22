# Chakravyuh

A first-person memory maze for your phone. Abhimanyu knew how to enter the Chakravyuh but never learned the way out.

1. Study the maze from above for a few seconds.
2. Walk it in first person, from memory: joystick to move and turn, drag the view to look around.
3. Fastest time wins. Every map peek adds 5 s.
4. After each level an AI Guru (Claude) reads your path, gives one memory tip and designs your next maze: harder if you did well, easier if you struggled.

Built solo at The Product Folks UnConference '26 Speedrun (22 Nov 2026) for RFS 01, "More Games, Made in India".

## Run
`npm install && npm run dev`. The AI Guru needs `ANTHROPIC_API_KEY` set on the server (Vercel env). Without it the game falls back to built-in tips and random mazes.

## Built with
Three.js, Vite, Vercel (static + one serverless function), Claude API (claude-haiku-5-5) for the Guru and level design, Claude Code (Opus) and OpenAI Codex as coding agents, AI image generation (Codex) for the wall and floor textures.
