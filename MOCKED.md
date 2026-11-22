# What's mocked or falls back

- **AI Guru fallback:** ring 1 and ring 2 are always made by a random maze algorithm, because there are no stats to learn from yet. From ring 3, if Claude's reply is late (over 6 s), fails validation twice, or the API is down, that ring falls back to the random maze and a built-in tip. Rings Claude designed say "designed by AI".
- **Best score** is stored only on your device (localStorage). There is no global leaderboard.
- **The spoken tip** uses the phone's built-in text-to-speech voice, not a custom AI voice.
- Nothing else is mocked: the movement, collisions, monsters, scoring and sound all run live in the browser.
