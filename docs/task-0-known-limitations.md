# Task 0 Known Limitations

- The frontend is a shell only and contains no production research features.
- The companion stores pairings and sessions in memory only.
- The keychain spike uses a generated runtime test secret and does not configure real AI provider credentials.
- Workspace selection accepts an existing local directory for spike validation only.
- Packaging uses PyInstaller smoke builds and documents signing/notarisation placeholders, but production signing is not configured.
- The PWA loopback spike validates local communication against a preview build, not a deployed GitHub Pages site.
- No OpenAlex, PDF processing, AI summaries, reading quests, synthesis, gap tracking, analytics, central backend, or cloud database is implemented.
