# Task 0 Security Assumptions

Task 0 validates only the architectural assumptions named in the bootstrap task.

## Assumptions Under Test

- The PWA can communicate with a local companion while remaining static-host compatible.
- The companion can bind only to loopback and reject remote-interface hosts.
- API requests from browser contexts can be restricted by an explicit allowed-origin list.
- Pairing can create a short-lived authenticated session without exposing keychain values.
- Keychain values can be written, read, and deleted through the operating-system keychain interface.
- Workspace file writes can use atomic temporary-file plus rename behavior.
- Workspace paths can be resolved relative to the selected workspace root and reject traversal.

## Out of Scope

Task 0 does not implement production AI processing, OpenAlex discovery, PDF processing, reading quests, synthesis, research-gap tracking, analytics, a central backend, or a cloud database.
