# Companion Packaging

Task 0 uses PyInstaller to smoke-test companion packaging on macOS and Windows.

## Local macOS Smoke Build

```bash
cd companion
python -m PyInstaller packaging/research-intelligence-companion.spec --noconfirm --clean
dist/research-intelligence-companion/research-intelligence-companion --check
```

## Signing and Notarisation Placeholders

Task 0 does not configure production signing. Before release, macOS builds need Developer ID signing and notarisation, and Windows builds need an appropriate code-signing certificate.

## Secret Safety

The Task 0 keychain spike generates test secrets at runtime. No test secret is hard-coded into source files or packaging configuration, and packaging smoke checks scan build artifacts for the sentinel test-secret string used by automated tests.
