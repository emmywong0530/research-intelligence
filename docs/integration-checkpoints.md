# Integration Checkpoints

Run after Task 2, every two later milestones, every durable migration,
security/storage changes, and before release hardening. Do not use a configured
workflow, unit-test-only path, mock fetch, or screenshot as a substitute for a
full-path result.

## Core checkpoint
1. Run packaged companion.
2. Open PWA from intended static origin.
3. Confirm loopback-only connectivity.
4. Pair through companion-owned approval.
5. Create workspace.
6. Restart frontend and companion.
7. Open workspace.
8. Create and reload one valid record.
9. Reject one invalid record.
10. Trigger stale-revision conflict.
11. Create backup.
12. Restore into safe test workspace.
13. Confirm no secrets in browser storage, workspace, logs, or API responses.
14. Confirm device-local indexes are outside workspace.
15. Run accessibility and containment checks.

For the Task 3D consolidation checkpoint, the disposable browser path must
also open a persisted project into Project Overview, verify project/profile/
proposal summaries, complete one real proposal decision, return to the
overview, reload, reopen the workspace and explicitly reopen the project.
This does not promote the overview to End-to-end verified unless the browser
and companion path actually passes.

For Task 3E paper-record integration, the disposable browser path must also
open the project Papers screen, verify the empty state, create a metadata-only
paper through the UI, edit and save it, return to Project Overview for the
paper count, reload, pair and reopen the workspace/project, and verify the
edited record through the companion-backed list. It must not select or commit
real PDFs or private papers. Unit tests and mocked fetch do not promote this
path to End-to-end verified.

For Task 3F notes integration, the disposable browser path must also create a
project note, reload it, create and edit a paper note from Paper detail, return
to Project Overview, and verify the combined note count after reload and
workspace/project reopen. It must use only disposable plain-text fixtures;
attachments and private research material are out of scope. Unit tests and
mocked fetch do not promote the notes path to End-to-end verified.

For Task 4A PDF-source integration, the disposable browser path must also
select generated PDF fixtures through the file input, verify the preview,
import the bytes through the real loopback companion, verify the stored source
metadata, reload and reopen the workspace/project/paper, explicitly replace
the source, and verify the replacement checksum and metadata after another
reload. It must never use a real user PDF or commit uploaded bytes. The flow
must exercise cleanup in `finally`; mocked fetch and direct HTTP upload tests
do not promote this path to End-to-end verified.

For Task 4B text-extraction integration, the disposable browser path must also
open the imported paper, observe `not_run`, explicitly extract a generated
multi-page PDF, verify bounded metrics and preview, replace the source, observe
`stale`, explicitly re-extract, and reload/reopen to verify the new source
checksum and preview. The companion must perform the parsing and the PWA must
not receive full text. No OCR or real/private PDF may be used. Mocked fetch and
direct parser/API tests do not promote this path to End-to-end verified.

For Task 4C duplicate detection, the disposable browser path must create or
open two projects, create one paper in each, import the same generated PDF,
verify an exact-source group with both owning projects, replace one PDF and
verify the exact group disappears, then align safe metadata/identifier values
and verify the conservative candidate/identifier groups. It must perform an
explicit review action and reload/reopen the workspace, project and paper to
verify the review state. The flow must use the real HTTPS static PWA and
loopback companion, with cleanup in `finally`; mocked fetch and direct API
tests are not browser evidence. No real user papers or private workspace may
be used.

Record results under `docs/integration-results/YYYY-MM-DD-milestone.md` with
environment, commit, commands, pass/fail evidence for every step, artifacts,
limitations, and follow-ups. Use the required fields in
[`docs/integration-results/README.md`](integration-results/README.md).

Use only disposable fixtures or an explicitly empty test workspace. Never
commit real user workspaces, API keys, credentials, private papers, unpublished
material, pairing/session secrets, or device-local indexes.

For Task 4D structured paper metadata, the disposable browser path must also
open the readable paper page, enter explicit edit mode, save bounded structured
metadata, verify normalized values and completeness, inspect source/extraction/
duplicate/note summaries, exercise sorting/filtering, reload/reopen and verify
the same paper state. It must not use remote metadata services or real papers.

For Task 5A provider foundation, the disposable browser path must also open
Settings after pairing, configure the approved provider, store only a
synthetic credential through the isolated test keychain, run the explicit fake
provider connection test, observe a controlled authentication failure,
replace and remove the credential, reload and re-pair, and verify that
nonsecret device-local configuration persists while the credential is absent.
The flow must never send project, paper, note or user research content to the
provider adapter. A fake provider is valid only when the companion is started
with explicit test mode; it is not production evidence for external provider
availability. The browser path must use the real HTTPS static PWA and
loopback companion with cleanup in `finally`.
