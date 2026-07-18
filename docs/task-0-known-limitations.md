# Task 0 Known Limitations

- The frontend is a shell only and contains no production research features.
- The companion stores pairings and sessions in memory only.
- The keychain spike uses a generated runtime test secret and does not configure real AI provider credentials.
- Workspace selection accepts an existing local directory for spike validation only.
- Packaging uses PyInstaller smoke builds and documents signing/notarisation placeholders, but production signing is not configured.
- The PWA loopback spike validates a built static PWA from a local HTTPS origin and separately validates the exact GitHub Pages production origin in CORS tests. It is not a deployed GitHub Pages run.
- Task 0 displays pairing approval codes in the companion console. A production local approval surface is still future work.
- Task 0 session tokens are in memory only and are invalid after companion restart.
- No OpenAlex, PDF processing, AI summaries, reading quests, synthesis, gap tracking, analytics, central backend, or cloud database is implemented.
