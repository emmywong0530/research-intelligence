import { chromium, expect } from "@playwright/test";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:https";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import process from "node:process";

const COMPANION_ORIGIN = "http://127.0.0.1:8765";
const STATIC_SPIKE_ORIGIN = "https://127.0.0.1:4443";
const PRODUCTION_ORIGIN = "https://emmywong0530.github.io";
const INVALID_ORIGIN = "https://example.invalid";
const DIST_DIR = resolve("apps/web/dist");
const deviceDataRoot = mkdtempSync(join(tmpdir(), "research-intelligence-task3d-device-"));

const companionEnv = {
  ...process.env,
  PYTHONPATH: "companion/src",
  PYTHONUNBUFFERED: "1",
  RI_DEVICE_DATA_ROOT: deviceDataRoot,
  RI_ALLOWED_ORIGINS: `${STATIC_SPIKE_ORIGIN},${PRODUCTION_ORIGIN}`,
  RI_AI_TEST_MODE: "1",
  RI_AI_TEST_CREDENTIAL_STORE: "memory",
  RI_AI_FAKE_PROVIDER_SCENARIO: "success",
  RI_HOST: "127.0.0.1",
  RI_PORT: "8765"
};

const processes = [];
const pairingCodes = new Map();
let httpsServer;

function start(name, command, args, env = process.env) {
  const child = spawn(command, args, { env, stdio: ["ignore", "pipe", "pipe"] });
  processes.push(child);
  child.stdout.on("data", (data) => handleProcessOutput(name, data, process.stdout));
  child.stderr.on("data", (data) => handleProcessOutput(name, data, process.stderr));
  return child;
}

function handleProcessOutput(name, data, stream) {
  const text = data.toString();
  stream.write(`[${name}] ${text}`);
  if (name !== "companion") {
    return;
  }
  for (const match of text.matchAll(/Pairing approval code for ([^:]+): ([0-9]{6})/g)) {
    pairingCodes.set(match[1], match[2]);
  }
}

function generateCertificate() {
  const certDir = mkdtempSync(join(tmpdir(), "research-intelligence-pwa-loopback-"));
  const keyPath = join(certDir, "key.pem");
  const certPath = join(certDir, "cert.pem");
  const result = spawnSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      keyPath,
      "-out",
      certPath,
      "-days",
      "1",
      "-subj",
      "/CN=127.0.0.1",
      "-addext",
      "subjectAltName=IP:127.0.0.1,DNS:localhost"
    ],
    { encoding: "utf8" }
  );
  if (result.status !== 0) {
    throw new Error(`openssl certificate generation failed: ${result.stderr || result.stdout}`);
  }
  return {
    key: readFileSync(keyPath),
    cert: readFileSync(certPath)
  };
}

function startStaticHttpsServer() {
  if (!existsSync(join(DIST_DIR, "index.html"))) {
    throw new Error("apps/web/dist/index.html is missing. Run pnpm frontend:build first.");
  }

  const tls = generateCertificate();
  httpsServer = createServer(tls, (request, response) => {
    const requestUrl = new URL(request.url || "/", STATIC_SPIKE_ORIGIN);
    const decodedPath = decodeURIComponent(requestUrl.pathname);
    let target = resolve(DIST_DIR, `.${decodedPath}`);
    if (!target.startsWith(`${DIST_DIR}/`) && target !== DIST_DIR) {
      response.writeHead(403);
      response.end("Forbidden");
      return;
    }
    if (!existsSync(target) || statSync(target).isDirectory()) {
      target = join(DIST_DIR, "index.html");
    }

    response.writeHead(200, {
      "Content-Type": mimeType(target),
      "Cache-Control": "no-store"
    });
    response.end(readFileSync(target));
  });

  return new Promise((resolveServer, rejectServer) => {
    httpsServer.once("error", rejectServer);
    httpsServer.listen(4443, "127.0.0.1", () => {
      console.log(`[static] serving ${DIST_DIR} at ${STATIC_SPIKE_ORIGIN}`);
      resolveServer();
    });
  });
}

function mimeType(path) {
  switch (extname(path)) {
    case ".css":
      return "text/css";
    case ".html":
      return "text/html";
    case ".js":
      return "text/javascript";
    case ".json":
      return "application/json";
    case ".svg":
      return "image/svg+xml";
    default:
      return "application/octet-stream";
  }
}

async function waitFor(url, timeoutMs = 20_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      await new Promise((resolveWait) => setTimeout(resolveWait, 250));
    }
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function assertStatus(label, response, expectedStatus) {
  if (response.status !== expectedStatus) {
    const body = await response.text();
    throw new Error(`${label} returned ${response.status}, expected ${expectedStatus}: ${body}`);
  }
}

async function jsonRequest(path, options = {}) {
  const response = await fetch(`${COMPANION_ORIGIN}${path}`, {
    ...options,
    headers: {
      Origin: STATIC_SPIKE_ORIGIN,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {})
    }
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`${options.method || "GET"} ${path} returned ${response.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

async function pairCompanionDirectly() {
  const started = await jsonRequest("/api/v1/pairing/start", { method: "POST" });
  const approvalCode = await waitForPairingCode(started.pairing_id);
  return jsonRequest("/api/v1/pairing/complete", {
    method: "POST",
    body: JSON.stringify({ pairing_id: started.pairing_id, approval_code: approvalCode })
  });
}

async function seedTask3DWorkspace() {
  const session = await pairCompanionDirectly();
  const workspacePath = mkdtempSync(join(tmpdir(), "research-intelligence-task3d-browser-"));
  try {
    const workspace = await jsonRequest("/api/v1/workspaces/create", {
      method: "POST",
      headers: { Authorization: `Bearer ${session.session_token}` },
      body: JSON.stringify({ path: workspacePath, name: "Task 3D browser workspace" })
    });
    const workspaceId = workspace.workspace_id;
    const projectId = "project-task3d-browser";
    const now = new Date().toISOString();
    await jsonRequest(`/api/v1/workspaces/${workspaceId}/records/projects/${projectId}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${session.session_token}` },
      body: JSON.stringify({
        record: {
          schema_version: "m2.v1",
          project_id: projectId,
          name: "Task 3D browser project",
          natural_language_research_idea: "Verify the persisted project overview in a disposable browser flow.",
          central_research_question: "Can a user review and reverse a persisted profile proposal?",
          created_at: now,
          updated_at: now
        }
      })
    });
    const profileId = `research_profile_${projectId}`;
    await jsonRequest(`/api/v1/workspaces/${workspaceId}/records/research-profiles/${profileId}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${session.session_token}` },
      body: JSON.stringify({
        parent_id: projectId,
        record: {
          schema_version: "m3c.v1",
          research_profile_id: profileId,
          project_id: projectId,
          central_research_question: "Can a user review and reverse a persisted profile proposal?",
          search_queries: ["AI advice interaction"],
          proposals: [{
            proposal_id: "proposal-task3d-browser",
            type: "new_search_terms",
            explanation: "Add a phrase that makes the explicit search scope more precise.",
            status: "proposed",
            reversible: true,
            created_at: now,
            target_field: "search_queries",
            current_value: { values: ["AI advice interaction"] },
            proposed_value: { values: ["conversational AI advice"] },
            history: [{ event: "created", status: "proposed", occurred_at: now }]
          }],
          created_at: now,
          updated_at: now
        }
      })
    });
    const duplicateProjectId = "project-task4c-browser";
    await jsonRequest(`/api/v1/workspaces/${workspaceId}/records/projects/${duplicateProjectId}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${session.session_token}` },
      body: JSON.stringify({
        record: {
          schema_version: "m2.v1",
          project_id: duplicateProjectId,
          name: "Task 4C duplicate project",
          natural_language_research_idea: "Verify deterministic duplicate evidence across project boundaries.",
          central_research_question: "Can local evidence stay scoped while duplicate warnings span the workspace?",
          created_at: now,
          updated_at: now
        }
      })
    });
    const task5cProjectId = "project-task5c-browser";
    const task5cPaperId = "paper-task5c-browser";
    const task5cProjectName = "Task 5C browser summary project";
    const task5cPaperTitle = "Task 5C browser summary paper";
    await jsonRequest(`/api/v1/workspaces/${workspaceId}/records/projects/${task5cProjectId}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${session.session_token}` },
      body: JSON.stringify({
        record: {
          schema_version: "m2.v1",
          project_id: task5cProjectId,
          name: task5cProjectName,
          natural_language_research_idea: "Verify bounded summaries over a dedicated local paper fixture.",
          central_research_question: "Can a user request and revisit a bounded local paper summary?",
          created_at: now,
          updated_at: now
        }
      })
    });
    await jsonRequest(`/api/v1/workspaces/${workspaceId}/records/papers/${task5cPaperId}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${session.session_token}` },
      body: JSON.stringify({
        parent_id: task5cProjectId,
        record: {
          schema_version: "m4d.v1",
          paper_id: task5cPaperId,
          title: task5cPaperTitle,
          authors: ["Task 5C browser fixture"],
          author_details: [{ literal_name: "Task 5C browser fixture" }],
          assigned_project_ids: [task5cProjectId],
          pdf_access_status: "unavailable",
          metadata_provenance: { record_origin: "manual" },
          created_at: now,
          updated_at: now
        }
      })
    });
    return {
      workspacePath,
      workspaceId,
      duplicateProjectId,
      task5cProjectId,
      task5cPaperId,
      task5cProjectName,
      task5cPaperTitle
    };
  } catch (error) {
    rmSync(workspacePath, { recursive: true, force: true });
    throw error;
  }
}

async function verifyOriginContract() {
  const pairingStartUrl = `${COMPANION_ORIGIN}/api/v1/pairing/start`;

  const productionStart = await fetch(pairingStartUrl, {
    method: "POST",
    headers: { Origin: PRODUCTION_ORIGIN }
  });
  await assertStatus("production origin pairing start", productionStart, 200);
  const productionPayload = await productionStart.json();
  if (productionPayload.pairing_code || productionPayload.approval_code) {
    throw new Error("pairing start exposed a browser-side approval secret");
  }

  const invalidStart = await fetch(pairingStartUrl, {
    method: "POST",
    headers: { Origin: INVALID_ORIGIN }
  });
  await assertStatus("invalid origin pairing start", invalidStart, 403);

  const allowedPreflight = await fetch(pairingStartUrl, {
    method: "OPTIONS",
    headers: {
      Origin: PRODUCTION_ORIGIN,
      "Access-Control-Request-Method": "POST"
    }
  });
  await assertStatus("production origin CORS preflight", allowedPreflight, 204);
  if (allowedPreflight.headers.get("access-control-allow-origin") !== PRODUCTION_ORIGIN) {
    throw new Error("production CORS preflight did not echo the configured origin");
  }

  const invalidPreflight = await fetch(pairingStartUrl, {
    method: "OPTIONS",
    headers: {
      Origin: INVALID_ORIGIN,
      "Access-Control-Request-Method": "POST"
    }
  });
  await assertStatus("invalid origin CORS preflight", invalidPreflight, 403);

  const missingOriginPreflight = await fetch(pairingStartUrl, {
    method: "OPTIONS",
    headers: { "Access-Control-Request-Method": "POST" }
  });
  await assertStatus("missing origin CORS preflight", missingOriginPreflight, 403);
}

async function waitForPairingCode(pairingId, timeoutMs = 10_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const code = pairingCodes.get(pairingId);
    if (code) {
      return code;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(`Timed out waiting for companion-owned approval code for ${pairingId}`);
}

async function openOnboarding(page) {
  await page.getByRole("button", { name: "Onboarding" }).click();
}

async function pairBrowser(page, { onboardingOpen = false } = {}) {
  if (!onboardingOpen) {
    await openOnboarding(page);
  }
  await page.getByRole("button", { name: "Start pairing" }).click();
  const pairingId = await page.getByTestId("pairing-id").textContent();
  if (!pairingId) {
    throw new Error("Could not read pairing_id from PWA pairing status");
  }
  const approvalCode = await waitForPairingCode(pairingId);
  await page.getByLabel("Approval code shown by companion").fill(approvalCode);
  await page.getByRole("button", { name: "Complete pairing" }).click();
  await page.getByTestId("pairing-session-status").waitFor({ timeout: 10_000 });
}

async function openBrowserWorkspace(page, workspacePath) {
  await page.getByLabel("Local workspace folder path").fill(workspacePath);
  await page.getByRole("button", { name: "Open existing workspace" }).click();
  await expect(page.getByTestId("workspace-connection-status")).toHaveAttribute("data-workspace-state", "connected", { timeout: 15_000 });
  await page.keyboard.press("Escape");
}

async function openPersistedPaper(page, title, { edit = true, paperId = null } = {}) {
  const paperRow = paperId
    ? page.getByTestId(`paper-record-row-${paperId}`)
    : page.getByRole("listitem").filter({ has: page.getByText(title, { exact: true }) });
  if (paperId) {
    await expect(paperRow).toHaveCount(1);
  }
  await expect(paperRow).toBeVisible({ timeout: 15_000 });
  await expect(paperRow.getByText(title, { exact: true })).toBeVisible();
  const openPaperButton = paperRow.getByRole("button", { name: "Open paper" });
  await expect(openPaperButton).toBeVisible();
  await openPaperButton.click();
  const readablePage = page.getByTestId("paper-readable-page");
  await expect(readablePage).toBeVisible({ timeout: 15_000 });
  await expect(readablePage.getByRole("heading", { name: title, exact: true })).toBeVisible();
  if (edit) {
    await page.getByRole("button", { name: "Edit metadata" }).click();
    await expect(page.getByLabel("Title *")).toHaveValue(title, { timeout: 15_000 });
  }
}

async function openLocalPdfManagement(page) {
  const localPdfHeading = page.getByRole("heading", { name: "Local PDF source", exact: true });
  if (!(await localPdfHeading.isVisible().catch(() => false))) {
    await page.getByRole("button", { name: "Manage local PDF", exact: true }).click();
  }
  await expect(localPdfHeading).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("paper-source-section")).toBeVisible();
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function pdfBytes(pages) {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pages.map((_, index) => `${3 + index * 2} 0 R`).join(" ")}] /Count ${pages.length} >>`
  ];
  const fontId = 3 + pages.length * 2;
  for (const [index, text] of pages.entries()) {
    const escaped = text.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
    const stream = `BT /F1 12 Tf 72 720 Td (${escaped}) Tj ET`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${4 + index * 2} 0 R >>`
    );
    objects.push(`<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`);
  }
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const chunks = [Buffer.from("%PDF-1.4\n", "latin1")];
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.concat(chunks).length);
    chunks.push(Buffer.from(`${index + 1} 0 obj\n${object}\nendobj\n`, "latin1"));
  }
  const xrefOffset = Buffer.concat(chunks).length;
  chunks.push(Buffer.from(`xref\n0 ${objects.length + 1}\n`, "ascii"));
  chunks.push(Buffer.from("0000000000 65535 f \n", "ascii"));
  for (const offset of offsets.slice(1)) {
    chunks.push(Buffer.from(`${String(offset).padStart(10, "0")} 00000 n \n`, "ascii"));
  }
  chunks.push(Buffer.from(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`, "ascii"));
  return Buffer.concat(chunks);
}

async function verifyTask4APdfFlow(page, fixtures) {
  await openLocalPdfManagement(page);
  await expect(page.getByTestId("paper-source-empty")).toBeVisible({ timeout: 10_000 });
  await page.getByTestId("paper-source-file-input").setInputFiles(fixtures.firstPath);
  await expect(page.getByTestId("paper-source-preview")).toContainText("task4a-first.pdf");
  await page.getByRole("button", { name: "Import PDF" }).click();
  await expect(page.getByTestId("paper-source-status")).toContainText("task4a-first.pdf", { timeout: 15_000 });
  await expect(page.getByTestId("paper-source-status")).toContainText("PDF stored; text not extracted");
  await expect(page.getByTestId("paper-source-status")).toContainText(sha256File(fixtures.firstPath));
  await expect(page.getByTestId("paper-extraction-not-run")).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "Extract text" }).click();
  await expect(page.getByTestId("paper-extraction-status")).toContainText("Text extracted locally.", { timeout: 15_000 });
  await expect(page.getByTestId("paper-extraction-page-count")).toHaveText("Pages 2");
  await expect(page.getByTestId("paper-extraction-pages-with-text")).toHaveText("Pages with text 2");
  await expect(page.getByTestId("paper-extraction-pages-without-text")).toHaveText("Pages without text 0");
  await expect(page.getByTestId("paper-extraction-engine")).toContainText("pypdf 6.14.2");
  await expect(page.getByTestId("paper-extraction-source-sha256")).toContainText(sha256File(fixtures.firstPath));
  await expect(page.getByTestId("paper-extraction-preview")).toContainText("Task 4B first page");
}

async function importPdfOnly(page, fixturePath, fixtureName) {
  await openLocalPdfManagement(page);
  await expect(page.getByTestId("paper-source-empty")).toBeVisible({ timeout: 10_000 });
  await page.getByTestId("paper-source-file-input").setInputFiles(fixturePath);
  await expect(page.getByTestId("paper-source-preview")).toContainText(fixtureName);
  await page.getByRole("button", { name: "Import PDF" }).click();
  await expect(page.getByTestId("paper-source-status")).toContainText(fixtureName, { timeout: 15_000 });
  await expect(page.getByTestId("paper-source-status")).toContainText(sha256File(fixturePath), { timeout: 15_000 });
}

async function readBrowserPaperSummaryRecord(page, { workspaceId, projectId, paperId, processingId }, authorization) {
  if (!authorization) {
    throw new Error(`No browser authorization was observed for paper summary ${processingId}`);
  }
  const url = `${COMPANION_ORIGIN}/api/v1/workspaces/${encodeURIComponent(workspaceId)}/projects/${encodeURIComponent(projectId)}/papers/${encodeURIComponent(paperId)}/ai-summary/records/${encodeURIComponent(processingId)}`;
  const result = await page.evaluate(async ({ recordUrl, bearerToken, expectedProcessingId }) => {
    const response = await fetch(recordUrl, {
      headers: { Authorization: bearerToken }
    });
    const payload = await response.json().catch(() => null);
    return { status: response.status, payload, expectedProcessingId };
  }, { recordUrl: url, bearerToken: authorization, expectedProcessingId: processingId });
  if (result.status < 200 || result.status >= 300 || !result.payload?.record) {
    const error = new Error(`Scoped paper summary read returned HTTP ${result.status}`);
    error.httpStatus = result.status;
    throw error;
  }
  if (result.payload.record.processing_id !== processingId) {
    throw new Error("Scoped paper summary read returned a different processing record");
  }
  return result.payload.record;
}

async function readBrowserPaperSummaryHistory(page, { workspaceId, projectId, paperId }, authorization) {
  if (!authorization) {
    throw new Error("No browser authorization was observed for paper summary history");
  }
  const url = `${COMPANION_ORIGIN}/api/v1/workspaces/${encodeURIComponent(workspaceId)}/projects/${encodeURIComponent(projectId)}/papers/${encodeURIComponent(paperId)}/ai-summary/records`;
  const result = await page.evaluate(async ({ recordUrl, bearerToken }) => {
    const response = await fetch(recordUrl, { headers: { Authorization: bearerToken } });
    const payload = await response.json().catch(() => null);
    return { status: response.status, payload };
  }, { recordUrl: url, bearerToken: authorization });
  if (result.status < 200 || result.status >= 300 || !Array.isArray(result.payload?.records)) {
    const error = new Error(`Paper summary history read returned HTTP ${result.status}`);
    error.httpStatus = result.status;
    throw error;
  }
  return result.payload.records.map(({ record }) => record);
}

function assertPaperSummaryRecordContract(record, { workspaceId, projectId, paperId, processingId }, expected = {}) {
  if (
    record.processing_id !== processingId ||
    record.workspace_id !== workspaceId ||
    record.project_id !== projectId ||
    record.paper_id !== paperId ||
    record.operation_id !== "paper_summary" ||
    record.operation_type !== "paper_summary" ||
    record.source_snapshot?.project_id !== projectId ||
    record.source_snapshot?.paper_id !== paperId ||
    record.provenance?.operation_id !== "paper_summary" ||
    record.provenance?.source_type !== "paper_extraction" ||
    record.provenance?.cache_disposition !== record.cache_disposition ||
    typeof record.source_snapshot_fingerprint !== "string" ||
    typeof record.cache_key !== "string" ||
    (record.status === "completed" && (!record.output || record.output.contract_id !== "paper-summary.v1")) ||
    (["failed", "cancelled"].includes(record.status) && record.output !== null)
  ) {
    throw new Error(`Paper summary ${processingId} returned an invalid scoped record contract`);
  }
  for (const [field, value] of Object.entries(expected)) {
    if (record[field] !== value) {
      throw new Error(`Paper summary ${processingId} expected ${field}=${String(value)}, observed ${String(record[field])}`);
    }
  }
}

async function waitForPaperSummaryTerminal(page, scope, authorizationRef, { expectedStatus = null, timeoutMs = 60_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = "unknown";
  let lastError = "none";
  while (Date.now() < deadline) {
    try {
      const record = await readBrowserPaperSummaryRecord(page, scope, authorizationRef.value);
      lastStatus = record.status;
      if (["completed", "failed", "cancelled"].includes(record.status)) {
        if (expectedStatus && record.status !== expectedStatus) {
          throw new Error(`Paper summary ${scope.processingId} reached ${record.status}; expected ${expectedStatus}`);
        }
        return record;
      }
      lastError = "none";
    } catch (error) {
      const httpStatus = error && typeof error === "object" ? error.httpStatus : null;
      if (typeof httpStatus === "number" && httpStatus >= 400 && httpStatus < 500 && ![408, 409, 429].includes(httpStatus)) {
        throw error;
      }
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error(`Paper summary ${scope.processingId} did not reach a terminal state within ${timeoutMs}ms; last status: ${lastStatus}; last read: ${lastError}`);
}

async function retryPaperSummaryAndWait(page, summary, scope, authorizationRef, originalStatus) {
  if (!(["failed", "cancelled"].includes(originalStatus))) {
    throw new Error(`Paper summary retry ${scope.processingId} received unsupported original status: ${originalStatus}`);
  }
  const originalRecord = await readBrowserPaperSummaryRecord(page, scope, authorizationRef.value);
  assertPaperSummaryRecordContract(originalRecord, scope, {
    status: originalStatus,
    cache_disposition: "cache_miss"
  });
  if (originalRecord.status !== originalStatus) {
    throw new Error(`Paper summary retry ${scope.processingId} expected original status ${originalStatus}, observed ${originalRecord.status}`);
  }
  const originalHistoryEvent = summary.getByTestId(`paper-summary-history-event-${scope.processingId}`);
  await expect(originalHistoryEvent).toBeVisible({ timeout: 15_000 });
  await expect(originalHistoryEvent).toHaveAttribute("data-status", originalStatus);
  await expect(originalHistoryEvent).toHaveAttribute("data-cache-disposition", "cache_miss");
  const expectedSummary = "Deterministic test summary prepared from the approved local extraction.";
  const retryUrl = `${COMPANION_ORIGIN}/api/v1/workspaces/${encodeURIComponent(scope.workspaceId)}/projects/${encodeURIComponent(scope.projectId)}/papers/${encodeURIComponent(scope.paperId)}/ai-summary/records/${encodeURIComponent(scope.processingId)}/retry`;
  const retryResponsePromise = page.waitForResponse((response) => response.url() === retryUrl && response.request().method() === "POST");
  await summary.getByRole("button", { name: "Retry summary" }).click();
  const retryResponse = await retryResponsePromise;
  if (!retryResponse.ok()) {
    throw new Error(`Paper summary retry returned HTTP ${retryResponse.status()}`);
  }
  const retryPayload = await retryResponse.json();
  const retryProcessingId = retryPayload.record?.processing_id;
  if (typeof retryProcessingId !== "string" || !retryProcessingId) {
    throw new Error("Paper summary retry did not return a processing_id");
  }
  if (retryPayload.record?.status !== "queued") {
    throw new Error(`Paper summary retry ${retryProcessingId} did not begin queued: ${retryPayload.record?.status ?? "missing"}`);
  }
  if (retryProcessingId === scope.processingId) {
    throw new Error("Paper summary retry reused the original processing_id");
  }

  const retryRecord = await waitForPaperSummaryTerminal(page, {
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    paperId: scope.paperId,
    processingId: retryProcessingId
  }, authorizationRef, { expectedStatus: "completed" });
  if (retryRecord.status !== "completed") {
    throw new Error(`Paper summary retry ${retryProcessingId} reached unexpected terminal state: ${retryRecord.status}`);
  }
  assertPaperSummaryRecordContract(retryRecord, {
    workspaceId: scope.workspaceId,
    projectId: scope.projectId,
    paperId: scope.paperId,
    processingId: retryProcessingId
  }, {
    status: "completed",
    cache_disposition: "cache_miss",
    retry_of_processing_id: scope.processingId
  });
  const output = retryRecord.output;
  const outputFields = output && typeof output === "object" ? Object.keys(output).sort() : [];
  const outputDiagnostic = JSON.stringify({
    processing_id: retryProcessingId,
    status: retryRecord.status,
    contract_id: output && typeof output === "object" ? output.contract_id ?? null : null,
    output_fields: outputFields,
    summary_length: output && typeof output.summary === "string" ? output.summary.length : null
  });
  const expectedFields = ["contract_id", "key_points", "limitations", "open_questions", "summary"];
  const hasExpectedFields = outputFields.length === expectedFields.length && expectedFields.every((field) => outputFields.includes(field));
  const validList = (value, maximum) => Array.isArray(value) && value.length <= maximum && value.every((item) => typeof item === "string" && item.length >= 1 && item.length <= 500);
  if (
    !output ||
    typeof output !== "object" ||
    output.contract_id !== "paper-summary.v1" ||
    !hasExpectedFields ||
    typeof output.summary !== "string" ||
    output.summary.length < 1 ||
    output.summary.length > 12_000 ||
    !Array.isArray(output.key_points) ||
    output.key_points.length < 1 ||
    output.key_points.length > 8 ||
    !validList(output.key_points, 8) ||
    !validList(output.limitations, 6) ||
    !validList(output.open_questions, 6) ||
    output.summary !== expectedSummary
  ) {
    throw new Error(`Paper summary retry ${retryProcessingId} returned an invalid paper-summary.v1 output: ${outputDiagnostic}`);
  }
  if (retryRecord.retry_of_processing_id !== scope.processingId) {
    throw new Error(`Paper summary retry ${retryProcessingId} did not preserve retry provenance`);
  }
  if (retryRecord.cache_disposition !== "cache_miss") {
    throw new Error(`Paper summary retry ${retryProcessingId} used unexpected cache disposition: ${retryRecord.cache_disposition}`);
  }
  const originalRecordAfterRetry = await readBrowserPaperSummaryRecord(page, scope, authorizationRef.value);
  assertPaperSummaryRecordContract(originalRecordAfterRetry, scope, { status: originalStatus });
  if (originalRecordAfterRetry.status !== originalStatus) {
    throw new Error(`Paper summary retry ${retryProcessingId} changed the original ${originalStatus} record`);
  }
  const retryHistoryEvent = summary.getByTestId(`paper-summary-history-event-${retryProcessingId}`);
  await expect(retryHistoryEvent).toBeVisible({ timeout: 15_000 });
  await expect(retryHistoryEvent).toHaveAttribute("data-status", "completed");
  await expect(retryHistoryEvent).toHaveAttribute("data-cache-disposition", "cache_miss");
  await expect(summary.getByTestId("paper-summary-output")).toContainText(expectedSummary, { timeout: 15_000 });
  await expect(summary.getByTestId("paper-summary-output")).toContainText(output.key_points[0]);
  if (output.limitations.length > 0) {
    await expect(summary.getByTestId("paper-summary-output")).toContainText(output.limitations[0]);
  }
  if (output.open_questions.length > 0) {
    await expect(summary.getByTestId("paper-summary-output")).toContainText(output.open_questions[0]);
  }
  await expect(summary).not.toContainText("synthetic output");
  return { processingId: retryProcessingId, record: retryRecord, originalRecord };
}

async function openBrowserProject(page, projectName) {
  await page.getByRole("link", { name: "Projects" }).click();
  await page.getByRole("heading", { name: "Projects saved locally" }).waitFor({ timeout: 10_000 });
  await page.getByRole("button", { name: new RegExp(projectName) }).click();
  await page.getByTestId("project-overview").waitFor({ timeout: 15_000 });
  await expect(page.getByRole("heading", { name: projectName })).toBeVisible();
}

async function openProjectPapers(page, projectName) {
  await openBrowserProject(page, projectName);
  await page.getByRole("button", { name: "Open Papers" }).click();
  await page.getByRole("heading", { name: `${projectName} papers` }).waitFor({ timeout: 10_000 });
}

async function startPaperSummaryFromConfirmation(page, summary, scope) {
  const startUrl = `${COMPANION_ORIGIN}/api/v1/workspaces/${encodeURIComponent(scope.workspaceId)}/projects/${encodeURIComponent(scope.projectId)}/papers/${encodeURIComponent(scope.paperId)}/ai-summary/start`;
  await summary.getByRole("button", { name: /^(Generate summary|Use cached summary)$/ }).click();
  const confirmation = page.getByRole("dialog", { name: "Generate a paper summary?" });
  await expect(confirmation).toBeVisible();
  const responsePromise = page.waitForResponse((response) => response.url() === startUrl && response.request().method() === "POST");
  await confirmation.getByRole("button", { name: "Confirm and generate" }).click();
  const response = await responsePromise;
  if (!response.ok()) {
    throw new Error(`Paper summary start returned HTTP ${response.status()}`);
  }
  const payload = await response.json();
  const record = payload.record;
  if (!record || typeof record.processing_id !== "string" || !["queued", "running", "completed"].includes(record.status)) {
    throw new Error("Paper summary start returned an invalid processing record");
  }
  if (typeof payload.reused_active !== "boolean") {
    throw new Error("Paper summary start omitted reused_active");
  }
  assertPaperSummaryRecordContract(record, { ...scope, processingId: record.processing_id });
  return record;
}

async function updatePaperMetadata(page, projectName, currentTitle, nextTitle, doi) {
  await openProjectPapers(page, projectName);
  await openPersistedPaper(page, currentTitle);
  await page.getByLabel("Title *").fill(nextTitle);
  await page.getByLabel("Authors *").fill("A. Browser");
  await page.getByLabel("Publication year").fill("2024");
  await page.getByLabel("DOI").fill(doi);
  await page.getByRole("button", { name: "Save paper" }).click();
  await expect(page.getByTestId("paper-save-status")).toContainText("Paper metadata saved locally", { timeout: 15_000 });
}

async function verifyTask4CDuplicateFlow(page, workspacePath, fixtures) {
  const projectA = "Task 3D browser project";
  const projectB = "Task 4C duplicate project";
  const paperA = "Updated browser-persisted paper record";
  const paperB = "Task 4C duplicate paper";

  await openProjectPapers(page, projectB);
  await expect(page.getByText("No paper records yet.")).toBeVisible();
  await page.getByRole("button", { name: "Add paper record" }).click();
  await page.getByLabel("Title *").fill(paperB);
  await page.getByLabel("Authors *").fill("B. Browser");
  await page.getByLabel("Publication year").fill("2024");
  await page.getByLabel("Venue or journal").fill("Task 4C Journal");
  await page.getByLabel("DOI").fill("10.1234/task4c-other");
  await page.getByRole("button", { name: "Create paper record" }).click();
  await expect(page.getByTestId("paper-save-status")).toContainText("Paper metadata saved locally", { timeout: 15_000 });
  await importPdfOnly(page, fixtures.secondPath, "task4a-second.pdf");
  await page.getByRole("button", { name: "Back to Project Overview" }).click();
  await page.getByTestId("project-overview").waitFor({ timeout: 15_000 });

  await openProjectPapers(page, projectA);
  await openPersistedPaper(page, paperA);
  await expect(page.getByTestId("paper-source-status")).toContainText("task4a-second.pdf", { timeout: 15_000 });
  await expect(page.getByTestId("paper-source-status")).toContainText(sha256File(fixtures.secondPath), { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: `${projectA} papers` })).toBeVisible();
  const exactGroup = page.getByTestId("duplicate-group-exact_source");
  await expect(exactGroup).toBeVisible({ timeout: 15_000 });
  await expect(exactGroup).toContainText("Exact PDF duplicate");
  await expect(exactGroup).toContainText(projectB);
  await expect(exactGroup).toContainText("task4a-second.pdf");
  await expect(exactGroup).toContainText(sha256File(fixtures.secondPath).slice(0, 12));
  await page.getByRole("button", { name: "Back to Project Overview" }).click();

  await openProjectPapers(page, projectB);
  await openPersistedPaper(page, paperB);
  await openLocalPdfManagement(page);
  await expect(page.getByTestId("paper-source-status")).toContainText("task4a-second.pdf", { timeout: 15_000 });
  await expect(page.getByTestId("paper-source-status")).toContainText(sha256File(fixtures.secondPath), { timeout: 15_000 });
  await page.getByTestId("paper-source-file-input").setInputFiles(fixtures.firstPath);
  await expect(page.getByTestId("paper-source-preview")).toContainText("task4a-first.pdf");
  await page.getByRole("button", { name: "Replace PDF" }).click();
  const replaceDialog = page.getByRole("dialog", { name: "Replace the stored PDF?" });
  await expect(replaceDialog).toBeVisible();
  await replaceDialog.getByRole("button", { name: "Replace PDF" }).click();
  await expect(page.getByTestId("paper-source-status")).toContainText("task4a-first.pdf", { timeout: 15_000 });
  await expect(page.getByTestId("paper-source-status")).toContainText(sha256File(fixtures.firstPath), { timeout: 15_000 });
  await page.getByRole("button", { name: "Back to Project Overview" }).click();

  await openProjectPapers(page, projectA);
  await openPersistedPaper(page, paperA);
  await expect(page.getByTestId("duplicate-group-exact_source")).toHaveCount(0);
  await page.getByRole("button", { name: "Back to Project Overview" }).click();

  const candidateTitle = "Task 4C normalized candidate";
  const candidateDoi = "10.1234/task4c-shared";
  await updatePaperMetadata(page, projectA, paperA, candidateTitle, candidateDoi);
  await page.getByRole("button", { name: "Back to Project Overview" }).click();
  await updatePaperMetadata(page, projectB, paperB, candidateTitle, candidateDoi);
  await page.getByRole("button", { name: "Back to Project Overview" }).click();

  await openProjectPapers(page, projectA);
  await openPersistedPaper(page, candidateTitle);
  await expect(page.getByTestId("duplicate-group-exact_identifier")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("duplicate-group-metadata_candidate")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("duplicate-group-metadata_candidate")).toContainText(projectB);
  await page.getByTestId("duplicate-group-metadata_candidate").getByRole("button", { name: "Mark as separate" }).click();
  await expect(page.getByTestId("duplicate-group-metadata_candidate")).toContainText("Reviewed as separate", { timeout: 15_000 });
  await page.reload();
  await page.getByRole("navigation", { name: "Primary navigation" }).waitFor({ timeout: 10_000 });
  await pairBrowser(page);
  await openBrowserWorkspace(page, workspacePath);
  await openProjectPapers(page, projectA);
  await openPersistedPaper(page, candidateTitle);
  await expect(page.getByTestId("duplicate-group-metadata_candidate")).toContainText("Reviewed as separate", { timeout: 15_000 });
  await expect(page.getByTestId("duplicate-group-exact_identifier")).toBeVisible();
}

async function verifyTask3DProjectOverviewFlow(page, workspacePath, fixtures, { onboardingOpen = false } = {}) {
  await pairBrowser(page, { onboardingOpen });
  await openBrowserWorkspace(page, workspacePath);
  await page.getByRole("link", { name: "Projects" }).click();
  await page.getByRole("heading", { name: "Projects saved locally" }).waitFor({ timeout: 10_000 });
  await page.getByRole("button", { name: /Task 3D browser project/ }).click();
  await page.getByTestId("project-overview").waitFor({ timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "Task 3D browser project" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Can a user review and reverse a persisted profile proposal?", level: 3 })).toBeVisible();
  await expect(page.getByTestId("overview-metric-weighted-concepts")).toHaveText(/0/);
  await expect(page.getByTestId("overview-metric-search-queries")).toHaveText(/1/);
  await expect(page.getByTestId("overview-metric-pending")).toHaveText(/1/);

  await page.getByRole("button", { name: "Review pending proposals" }).click();
  await page.getByRole("heading", { name: "Profile change proposals" }).waitFor({ timeout: 10_000 });
  await page.getByRole("button", { name: "Accept proposal" }).click();
  await page.getByRole("button", { name: "Apply proposal change" }).click();
  await page.getByTestId("project-overview").waitFor({ timeout: 15_000 });
  await expect(page.getByTestId("overview-metric-pending")).toHaveText(/0/);
  await expect(page.getByTestId("overview-metric-accepted")).toHaveText(/1/);

  await page.getByRole("button", { name: "Open Papers" }).click();
  await page.getByRole("heading", { name: "Task 3D browser project papers" }).waitFor({ timeout: 10_000 });
  await expect(page.getByText("No paper records yet.")).toBeVisible();
  await page.getByRole("button", { name: "Add paper record" }).click();
  await page.getByLabel("Title *").fill("A browser-persisted paper record");
  await page.getByLabel("Authors *").fill("A. Browser\nB. Companion");
  await page.getByLabel("Publication year").fill("2024");
  await page.getByLabel("Venue or journal").fill("Task 3E Journal");
  await page.getByLabel("DOI").fill("10.1234/task3e");
  await page.getByRole("button", { name: "Create paper record" }).click();
  await expect(page.getByTestId("paper-save-status")).toContainText("Paper metadata saved locally", { timeout: 10_000 });
  await expect(page.getByRole("heading", { name: "A browser-persisted paper record" })).toBeVisible();
  await openLocalPdfManagement(page);
  await verifyTask4APdfFlow(page, fixtures);
  await page.getByRole("button", { name: "Back to Papers" }).click();
  await openPersistedPaper(page, "A browser-persisted paper record");
  await page.getByLabel("Title *").fill("Updated browser-persisted paper record");
  await page.getByRole("button", { name: "Save paper" }).click();
  await expect(page.getByTestId("paper-save-status")).toContainText("Paper metadata saved locally", { timeout: 10_000 });
  await page.getByRole("button", { name: "Back to Project Overview" }).click();
  await page.getByTestId("project-overview").waitFor({ timeout: 15_000 });
  await expect(page.getByTestId("overview-paper-count")).toHaveText(/1 paper record/);
  await expect(page.getByText("Updated browser-persisted paper record")).toBeVisible();
  await verifyTask3FNotesFlow(page);

  await page.reload();
  await page.getByRole("navigation", { name: "Primary navigation" }).waitFor({ timeout: 10_000 });
  await pairBrowser(page);
  await openBrowserWorkspace(page, workspacePath);
  await page.getByRole("link", { name: "Projects" }).click();
  await page.getByRole("heading", { name: "Projects saved locally" }).waitFor({ timeout: 10_000 });
  await page.getByRole("button", { name: /Task 3D browser project/ }).click();
  await page.getByTestId("project-overview").waitFor({ timeout: 15_000 });
  await expect(page.getByTestId("overview-metric-pending")).toHaveText(/0/);
  await expect(page.getByTestId("overview-metric-accepted")).toHaveText(/1/);
  await expect(page.getByTestId("overview-paper-count")).toHaveText(/1 paper record/);

  await page.getByRole("button", { name: "Open Notes" }).click();
  await page.getByRole("heading", { name: "Task 3D browser project notes" }).waitFor({ timeout: 10_000 });
  await expect(page.getByText("Project observation", { exact: true })).toBeVisible();
  await expect(page.getByText("Updated paper observation", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByTestId("project-overview").waitFor({ timeout: 15_000 });
  await page.getByRole("button", { name: "Open Papers" }).click();
  await page.getByRole("heading", { name: "Task 3D browser project papers" }).waitFor({ timeout: 10_000 });
  await openPersistedPaper(page, "Updated browser-persisted paper record");
  await openLocalPdfManagement(page);
  await expect(page.getByTestId("paper-source-status")).toContainText("task4a-first.pdf", { timeout: 15_000 });
  await page.getByTestId("paper-source-file-input").setInputFiles(fixtures.secondPath);
  await expect(page.getByTestId("paper-source-preview")).toContainText("task4a-second.pdf");
  await page.getByRole("button", { name: "Replace PDF" }).click();
  const replaceDialog = page.getByRole("dialog", { name: "Replace the stored PDF?" });
  await expect(replaceDialog).toBeVisible();
  await replaceDialog.getByRole("button", { name: "Replace PDF" }).click();
  await expect(page.getByTestId("paper-source-status")).toContainText("task4a-second.pdf", { timeout: 15_000 });
  await expect(page.getByTestId("paper-source-status")).toContainText(sha256File(fixtures.secondPath));
  await expect(page.getByTestId("paper-extraction-status")).toContainText("stale", { timeout: 15_000 });
  await page.getByRole("button", { name: "Re-extract text" }).click();
  await expect(page.getByTestId("paper-extraction-status")).toContainText("Text extracted locally.", { timeout: 15_000 });
  await expect(page.getByTestId("paper-extraction-source-sha256")).toContainText(sha256File(fixtures.secondPath));
  await expect(page.getByTestId("paper-extraction-preview")).toContainText("Task 4B replacement page");
  await page.getByRole("button", { name: "Paper notes" }).click();
  await page.getByRole("heading", { name: "Updated browser-persisted paper record notes" }).waitFor({ timeout: 10_000 });
  await expect(page.getByText("Project observation", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Updated paper observation", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByRole("heading", { name: "Task 3D browser project papers" }).waitFor({ timeout: 15_000 });
  await page.getByRole("button", { name: "Back to Project Overview" }).click();
  await page.getByTestId("project-overview").waitFor({ timeout: 15_000 });

  await page.getByRole("button", { name: "Open Research Profile" }).click();
  await page.getByRole("heading", { name: "Profile change proposals" }).waitFor({ timeout: 10_000 });
  await page.getByRole("button", { name: "Reverse proposal" }).click();
  await page.getByRole("button", { name: "Reverse proposal", exact: true }).last().click();
  await page.getByTestId("project-overview").waitFor({ timeout: 15_000 });
  await expect(page.getByTestId("overview-metric-reversed")).toHaveText(/1/);

  await page.reload();
  await page.getByRole("navigation", { name: "Primary navigation" }).waitFor({ timeout: 10_000 });
  await pairBrowser(page);
  await openBrowserWorkspace(page, workspacePath);
  await page.getByRole("link", { name: "Projects" }).click();
  await page.getByRole("heading", { name: "Projects saved locally" }).waitFor({ timeout: 10_000 });
  await page.getByRole("button", { name: /Task 3D browser project/ }).click();
  await page.getByTestId("project-overview").waitFor({ timeout: 15_000 });
  await expect(page.getByTestId("overview-metric-reversed")).toHaveText(/1/);

  await page.getByRole("button", { name: "Open Papers" }).click();
  await page.getByRole("heading", { name: "Task 3D browser project papers" }).waitFor({ timeout: 10_000 });
  await openPersistedPaper(page, "Updated browser-persisted paper record");
  await expect(page.getByTestId("paper-source-status")).toContainText("task4a-second.pdf", { timeout: 15_000 });
  await expect(page.getByTestId("paper-extraction-status")).toContainText("Text extracted locally.", { timeout: 15_000 });
  await expect(page.getByTestId("paper-extraction-source-sha256")).toContainText(sha256File(fixtures.secondPath));
  await expect(page.getByTestId("paper-extraction-preview")).toContainText("Task 4B replacement page");
  await page.getByRole("button", { name: "Back to Project Overview" }).click();
  await page.getByTestId("project-overview").waitFor({ timeout: 15_000 });
}

async function verifyTask4DPaperMetadataFlow(page) {
  const projectName = "Task 3D browser project";
  const paperTitle = "Updated browser-persisted paper record";

  await openProjectPapers(page, projectName);
  await openPersistedPaper(page, paperTitle, { edit: false });
  const readablePage = page.getByTestId("paper-readable-page");
  await expect(readablePage.getByTestId("paper-metadata-summary")).toBeVisible();
  await expect(readablePage).toContainText("PDF stored");
  await expect(page.getByTestId("paper-notes-summary")).toContainText("1 note");
  await page.getByRole("button", { name: "Edit metadata" }).click();
  await page.getByRole("textbox", { name: /Structured author rows/ }).fill("A. Browser\nB. Companion");
  await page.getByLabel("Publisher").fill("Task 4D Publisher");
  await page.getByLabel("Publication type").fill("journal_article");
  await page.getByLabel("Publication status").fill("published");
  await page.getByLabel("Keywords").fill("local\nmetadata");
  await page.getByLabel("PMID").fill("12345");
  await page.getByLabel("Abstract").fill("A manually maintained local metadata abstract.");
  await page.getByLabel("Source URL").fill("https://example.org/task4d-record");
  await page.getByRole("button", { name: "Save paper" }).click();
  await expect(page.getByTestId("paper-save-status")).toContainText("Paper metadata saved locally", { timeout: 15_000 });
  await page.getByRole("button", { name: "Back to Project Overview" }).click();
  await page.getByTestId("project-overview").waitFor({ timeout: 15_000 });

  await page.getByRole("button", { name: "Open Papers" }).click();
  await page.getByRole("heading", { name: `${projectName} papers` }).waitFor({ timeout: 10_000 });
  await openPersistedPaper(page, paperTitle, { edit: false });
  const reloadedReadablePage = page.getByTestId("paper-readable-page");
  await expect(reloadedReadablePage).toContainText("Task 4D Publisher");
  await expect(reloadedReadablePage).toContainText("local, metadata");
  await expect(reloadedReadablePage).toContainText("12345");
  await expect(reloadedReadablePage).toContainText("A manually maintained local metadata abstract.");
  await expect(reloadedReadablePage).toContainText("Open source link");
  await expect(page.getByTestId("paper-notes-summary")).toContainText("1 note");
  await page.getByRole("button", { name: "Back to Project Overview" }).click();
  await page.getByTestId("project-overview").waitFor({ timeout: 15_000 });
}

async function verifyTask5AProviderFlow(page, workspacePath) {
  const providerKey = "synthetic-browser-provider-key";
  const replacementProviderKey = "synthetic-browser-provider-key-replacement";
  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("heading", { name: "Workspace, AI, automation and privacy" }).waitFor({ timeout: 10_000 });
  await page.getByRole("button", { name: "AI & budgets" }).click();
  await page.getByTestId("ai-provider-settings").waitFor({ timeout: 15_000 });
  await expect(page.getByTestId("ai-provider-state")).toContainText("No AI provider configured");
  await expect(page.getByRole("button", { name: "Test provider connection" })).toBeDisabled();

  await page.getByRole("button", { name: "Configure provider" }).click();
  await expect(page.getByTestId("ai-provider-state")).toContainText("Provider configured, credential missing");
  await page.getByRole("button", { name: "Add credential" }).click();
  await page.getByTestId("ai-provider-credential-input").fill(providerKey);
  await page.getByRole("button", { name: "Store in OS keychain" }).click();
  await expect(page.getByTestId("ai-provider-state")).toContainText("Ready to test", { timeout: 15_000 });
  await expect(page.getByTestId("ai-provider-credential-input")).toHaveCount(0);
  await expect(page.locator(`text=${providerKey}`)).toHaveCount(0);

  await page.getByRole("button", { name: "Test provider connection" }).click();
  await expect(page.getByTestId("ai-provider-test-result")).toContainText("Provider connection verified.", { timeout: 15_000 });
  await expect(page.getByTestId("ai-provider-state")).toContainText("Connection verified");

  const scenarioSession = await pairCompanionDirectly();
  await jsonRequest("/api/v1/ai/provider/test-scenario", {
    method: "POST",
    headers: { Authorization: `Bearer ${scenarioSession.session_token}` },
    body: JSON.stringify({ scenario: "authentication_failed" })
  });
  await page.getByRole("button", { name: "Test provider connection" }).click();
  await expect(page.getByTestId("ai-provider-test-result")).toContainText("rejected the credential", { timeout: 15_000 });
  await expect(page.getByTestId("ai-provider-state")).toContainText("Connection test failed");

  await page.getByRole("button", { name: "Replace credential" }).click();
  await page.getByTestId("ai-provider-credential-input").fill(replacementProviderKey);
  await page.getByRole("button", { name: "Store in OS keychain" }).click();
  await expect(page.getByTestId("ai-provider-state")).toContainText("Ready to test", { timeout: 15_000 });
  await page.getByRole("button", { name: "Remove credential" }).click();
  await expect(page.getByTestId("ai-provider-state")).toContainText("Credential removed", { timeout: 15_000 });
  await expect(page.getByRole("button", { name: "Test provider connection" })).toBeDisabled();

  await page.reload();
  await page.getByRole("navigation", { name: "Primary navigation" }).waitFor({ timeout: 10_000 });
  await pairBrowser(page);
  await openBrowserWorkspace(page, workspacePath);
  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("button", { name: "AI & budgets" }).click();
  await page.getByTestId("ai-provider-settings").waitFor({ timeout: 15_000 });
  await expect(page.getByRole("textbox", { name: "Provider model" })).toHaveValue("gpt-4o-mini");
  await expect(page.getByTestId("ai-provider-state")).toContainText("Credential removed");
  await expect(page.getByTestId("ai-provider-connection-status")).toContainText("No credential stored");
  await expect(page.getByRole("button", { name: "Test provider connection" })).toBeDisabled();
  await expect(page.locator("body")).not.toContainText(providerKey);
  await expect(page.locator("body")).not.toContainText(replacementProviderKey);
  const browserStorage = await page.evaluate(() => ({
    localStorage: Object.entries(window.localStorage),
    sessionStorage: Object.entries(window.sessionStorage)
  }));
  expect(JSON.stringify(browserStorage)).not.toMatch(/provider|gpt-4o-mini|synthetic-browser-provider-key/i);
}

async function verifyTask5BProcessingFlow(page, workspacePath) {
  await page.getByTestId("ai-processing-panel").waitFor({ timeout: 15_000 });
  await expect(page.getByTestId("ai-processing-panel")).toContainText("Synthetic provider processing test");
  await expect(page.getByText("task5b.provider_echo_test · v1.0.0", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Run synthetic processing test" }).click();
  await expect(page.getByTestId("ai-processing-result")).toContainText("completed", { timeout: 15_000 });
  await expect(page.getByTestId("ai-processing-result")).toContainText("Cache: cache_miss");
  await expect(page.getByTestId("ai-processing-output")).toContainText("Synthetic provider processing completed.");

  await page.getByRole("button", { name: "Run synthetic processing test" }).click();
  await expect(page.getByTestId("ai-processing-result")).toContainText("Cache: cache_hit", { timeout: 15_000 });

  await page.getByLabel("Synthetic input version").fill("v2");
  await page.getByRole("button", { name: "Run synthetic processing test" }).click();
  await expect(page.getByTestId("ai-processing-result")).toContainText("Source version: v2", { timeout: 15_000 });
  await expect(page.getByTestId("ai-processing-result")).toContainText("completed", { timeout: 15_000 });
  await expect(page.getByTestId("ai-processing-result")).toContainText("Cache: cache_miss");

  await page.getByLabel("Test-only provider scenario").selectOption("invalid_output");
  await page.getByRole("button", { name: "Set test scenario" }).click();
  await page.getByLabel("Synthetic input version").fill("invalid-v1");
  await page.getByRole("button", { name: "Run synthetic processing test" }).click();
  await expect(page.getByTestId("ai-processing-result")).toContainText("failed", { timeout: 15_000 });
  await expect(page.getByTestId("ai-processing-result")).toContainText("outside the registered contract");

  await page.getByLabel("Test-only provider scenario").selectOption("success");
  await page.getByRole("button", { name: "Set test scenario" }).click();
  await page.getByRole("button", { name: "Retry explicitly" }).click();
  await expect(page.getByTestId("ai-processing-result")).toContainText("completed", { timeout: 15_000 });

  await page.getByLabel("Test-only provider scenario").selectOption("delayed");
  await page.getByRole("button", { name: "Set test scenario" }).click();
  await page.getByLabel("Synthetic input version").fill("cancel-v1");
  await page.getByRole("button", { name: "Run synthetic processing test" }).click();
  await expect(page.getByRole("button", { name: "Cancel processing" })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Cancel processing" }).click();
  await expect(page.getByTestId("ai-processing-result")).toContainText("cancelled", { timeout: 15_000 });

  await page.getByLabel("Test-only provider scenario").selectOption("success");
  await page.getByRole("button", { name: "Set test scenario" }).click();
  await page.getByLabel("Synthetic input version").fill("invalidate-v1");
  await page.getByRole("button", { name: "Run synthetic processing test" }).click();
  await expect(page.getByTestId("ai-processing-result")).toContainText("completed", { timeout: 15_000 });
  await page.getByRole("button", { name: "Invalidate cache" }).click();
  await expect(page.getByTestId("ai-processing-result")).toContainText("Cache invalidated", { timeout: 15_000 });

  await page.reload();
  await page.getByRole("navigation", { name: "Primary navigation" }).waitFor({ timeout: 10_000 });
  await pairBrowser(page);
  await openBrowserWorkspace(page, workspacePath);
  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("button", { name: "AI & budgets" }).click();
  await page.getByTestId("ai-processing-panel").waitFor({ timeout: 15_000 });
  await expect(page.getByText("invalidate-v1", { exact: true })).toBeVisible();
  await expect(page.getByTestId("ai-processing-panel")).toContainText("History");
  const browserStorage = await page.evaluate(() => ({
    localStorage: Object.entries(window.localStorage),
    sessionStorage: Object.entries(window.sessionStorage)
  }));
  expect(JSON.stringify(browserStorage)).not.toMatch(/processing|prompt|synthetic_input|gpt-4o-mini/i);
}

async function setPaperSummaryScenario(scenario) {
  const session = await pairCompanionDirectly();
  await jsonRequest("/api/v1/ai/processing/test-scenario", {
    method: "POST",
    headers: { Authorization: `Bearer ${session.session_token}` },
    body: JSON.stringify({ scenario })
  });
}

async function editPaperTitle(page, currentTitle, nextTitle) {
  await openPersistedPaper(page, currentTitle);
  await page.getByLabel("Title *").fill(nextTitle);
  await page.getByRole("button", { name: "Save paper" }).click();
  await expect(page.getByTestId("paper-save-status")).toContainText("Paper metadata saved locally", { timeout: 15_000 });
  await expect(page.getByTestId("paper-readable-page").getByRole("heading", { name: nextTitle, exact: true })).toBeVisible({ timeout: 15_000 });
}

async function verifyTask5CSummaryFlow(page, workspace, fixtures, authorizationRef) {
  const providerKey = "synthetic-browser-summary-key";
  const { workspacePath, workspaceId, task5cPaperId, task5cProjectId, task5cPaperTitle, task5cProjectName } = workspace;
  let paperTitle = task5cPaperTitle;
  const summaryScope = { workspaceId, projectId: task5cProjectId, paperId: task5cPaperId };
  let summaryStartRequestCount = 0;
  const observeSummaryStart = (request) => {
    if (request.url().endsWith(`/workspaces/${encodeURIComponent(workspaceId)}/projects/${encodeURIComponent(task5cProjectId)}/papers/${encodeURIComponent(task5cPaperId)}/ai-summary/start`) && request.method() === "POST") {
      summaryStartRequestCount += 1;
    }
  };
  page.on("request", observeSummaryStart);

  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("heading", { name: "Workspace, AI, automation and privacy" }).waitFor({ timeout: 10_000 });
  await page.getByRole("button", { name: "AI & budgets" }).click();
  const providerSettings = page.getByTestId("ai-provider-settings");
  await providerSettings.waitFor({ timeout: 15_000 });
  await providerSettings.getByRole("button", { name: "Add credential" }).click();
  await page.getByTestId("ai-provider-credential-input").fill(providerKey);
  await providerSettings.getByRole("button", { name: "Store in OS keychain" }).click();
  await expect(providerSettings.getByTestId("ai-provider-state")).toContainText("Ready to test", { timeout: 15_000 });
  await expect(page.locator("body")).not.toContainText(providerKey);

  await openProjectPapers(page, task5cProjectName);
  await expect(page.getByTestId(`paper-record-row-${task5cPaperId}`)).toBeVisible({ timeout: 15_000 });
  await openPersistedPaper(page, paperTitle, { edit: false, paperId: task5cPaperId });
  await openLocalPdfManagement(page);
  await importPdfOnly(page, fixtures.summaryPath, "task5c-summary.pdf");
  await expect(page.getByTestId("paper-extraction-not-run")).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "Extract text" }).click();
  await expect(page.getByTestId("paper-extraction-status")).toContainText("Text extracted locally.", { timeout: 15_000 });
  await expect(page.getByTestId("paper-extraction-source-sha256")).toContainText(sha256File(fixtures.summaryPath));
  await expect(page.getByTestId("paper-extraction-preview")).toContainText("Task 5C summary source");
  await page.getByRole("button", { name: "Back to Papers" }).click();
  await expect(page.getByRole("heading", { name: `${task5cProjectName} papers` })).toBeVisible({ timeout: 15_000 });
  await openPersistedPaper(page, paperTitle, { edit: false, paperId: task5cPaperId });
  const summary = page.getByTestId("paper-summary-section");
  await summary.waitFor({ timeout: 15_000 });
  await expect(summary.getByTestId("paper-summary-source")).toBeVisible({ timeout: 15_000 });

  await summary.getByRole("button", { name: "Generate summary" }).click();
  const confirmation = page.getByRole("dialog", { name: "Generate a paper summary?" });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole("button", { name: "Cancel" }).click();
  await expect(confirmation).toHaveCount(0);
  if (summaryStartRequestCount !== 0) {
    throw new Error("Dismissing paper summary confirmation created a processing request");
  }

  const initialStarted = await startPaperSummaryFromConfirmation(page, summary, summaryScope);
  const initialRecord = await waitForPaperSummaryTerminal(page, {
    ...summaryScope,
    processingId: initialStarted.processing_id
  }, authorizationRef, { expectedStatus: "completed" });
  assertPaperSummaryRecordContract(initialRecord, {
    ...summaryScope,
    processingId: initialStarted.processing_id
  }, { status: "completed", cache_disposition: "cache_miss", stale: false, invalidated: false });
  await expect(summary.getByTestId("paper-summary-output")).toContainText("Deterministic test summary", { timeout: 15_000 });
  await expect(summary.getByTestId(`paper-summary-history-event-${initialStarted.processing_id}`)).toHaveAttribute("data-status", "completed");
  await expect(summary.getByTestId(`paper-summary-history-event-${initialStarted.processing_id}`)).toHaveAttribute("data-cache-disposition", "cache_miss");
  await expect(summary.getByRole("button", { name: "Use cached summary" })).toBeVisible({ timeout: 15_000 });

  const cachedStarted = await startPaperSummaryFromConfirmation(page, summary, summaryScope);
  assertPaperSummaryRecordContract(cachedStarted, {
    ...summaryScope,
    processingId: cachedStarted.processing_id
  }, { status: "completed", cache_disposition: "cache_hit", original_processing_id: initialStarted.processing_id });
  if (cachedStarted.processing_id === initialStarted.processing_id) {
    throw new Error("Paper summary cache reuse reused the initial processing_id");
  }
  const cachedRecord = await readBrowserPaperSummaryRecord(page, {
    ...summaryScope,
    processingId: cachedStarted.processing_id
  }, authorizationRef.value);
  assertPaperSummaryRecordContract(cachedRecord, {
    ...summaryScope,
    processingId: cachedStarted.processing_id
  }, { status: "completed", cache_disposition: "cache_hit", original_processing_id: initialStarted.processing_id });
  await expect(summary.getByTestId(`paper-summary-history-event-${cachedStarted.processing_id}`)).toHaveAttribute("data-status", "completed");
  await expect(summary.getByTestId(`paper-summary-history-event-${cachedStarted.processing_id}`)).toHaveAttribute("data-cache-disposition", "cache_hit");

  const changedTitle = "Task 5C changed source paper";
  await page.getByRole("button", { name: "Edit metadata" }).click();
  await page.getByLabel("Title *").fill(changedTitle);
  await page.getByRole("button", { name: "Save paper" }).click();
  await expect(page.getByTestId("paper-save-status")).toContainText("Paper metadata saved locally", { timeout: 15_000 });
  await expect(page.getByTestId("paper-summary-section").getByRole("button", { name: "Generate summary" })).toBeVisible({ timeout: 15_000 });
  paperTitle = changedTitle;

  await setPaperSummaryScenario("invalid_output");
  const changedSummary = page.getByTestId("paper-summary-section");
  await changedSummary.getByRole("button", { name: "Generate summary" }).click();
  const invalidStartResponsePromise = page.waitForResponse((response) => response.url() === `${COMPANION_ORIGIN}/api/v1/workspaces/${encodeURIComponent(workspaceId)}/projects/${encodeURIComponent(task5cProjectId)}/papers/${encodeURIComponent(task5cPaperId)}/ai-summary/start` && response.request().method() === "POST");
  await page.getByRole("dialog", { name: "Generate a paper summary?" }).getByRole("button", { name: "Confirm and generate" }).click();
  const invalidStartResponse = await invalidStartResponsePromise;
  if (!invalidStartResponse.ok()) {
    throw new Error(`Paper summary start returned HTTP ${invalidStartResponse.status()}`);
  }
  const invalidStartPayload = await invalidStartResponse.json();
  const invalidProcessingId = invalidStartPayload.record?.processing_id;
  if (typeof invalidProcessingId !== "string" || !invalidProcessingId) {
    throw new Error("Paper summary start did not return a processing_id");
  }
  const invalidRecord = await waitForPaperSummaryTerminal(page, {
    workspaceId,
    projectId: task5cProjectId,
    paperId: task5cPaperId,
    processingId: invalidProcessingId
  }, authorizationRef, { expectedStatus: "failed" });
  assertPaperSummaryRecordContract(invalidRecord, {
    ...summaryScope,
    processingId: invalidProcessingId
  }, { status: "failed", cache_disposition: "cache_miss", stale: false, invalidated: false });
  if (invalidRecord.status !== "failed") {
    throw new Error(`Paper summary ${invalidProcessingId} reached unexpected terminal state: ${invalidRecord.status}`);
  }
  if (invalidRecord.error?.category !== "invalid_output") {
    throw new Error(`Paper summary ${invalidProcessingId} failed with unexpected category: ${invalidRecord.error?.category ?? "missing"}`);
  }
  const failedSummaryStatus = changedSummary.getByTestId("paper-summary-processing-status");
  await expect(failedSummaryStatus).toContainText("Latest request: failed", { timeout: 15_000 });
  await expect(failedSummaryStatus).toContainText("The provider returned an unsupported paper summary contract.");
  const invalidHistoryEvent = changedSummary.getByTestId(`paper-summary-history-event-${invalidProcessingId}`);
  await expect(invalidHistoryEvent).toBeVisible({ timeout: 15_000 });
  await expect(invalidHistoryEvent).toHaveAttribute("data-status", "failed");
  await expect(invalidHistoryEvent).toHaveAttribute("data-cache-disposition", "cache_miss");
  await expect(changedSummary).not.toContainText("synthetic output");
  await expect(changedSummary).not.toContainText("provider_request_id");
  await expect(changedSummary.getByRole("button", { name: "Retry summary" })).toBeVisible();
  const staleInitial = await readBrowserPaperSummaryRecord(page, { ...summaryScope, processingId: initialStarted.processing_id }, authorizationRef.value);
  const staleCached = await readBrowserPaperSummaryRecord(page, { ...summaryScope, processingId: cachedStarted.processing_id }, authorizationRef.value);
  assertPaperSummaryRecordContract(staleInitial, { ...summaryScope, processingId: initialStarted.processing_id }, { status: "completed", cache_disposition: "cache_miss", stale: true, invalidated: false });
  assertPaperSummaryRecordContract(staleCached, { ...summaryScope, processingId: cachedStarted.processing_id }, { status: "completed", cache_disposition: "cache_hit", stale: true, invalidated: false });

  await setPaperSummaryScenario("success");
  const retriedSummary = await retryPaperSummaryAndWait(page, changedSummary, {
    workspaceId,
    projectId: task5cProjectId,
    paperId: task5cPaperId,
    processingId: invalidProcessingId
  }, authorizationRef, "failed");
  const failedRecordAfterRetry = await readBrowserPaperSummaryRecord(page, {
    workspaceId,
    projectId: task5cProjectId,
    paperId: task5cPaperId,
    processingId: invalidProcessingId
  }, authorizationRef.value);
  if (failedRecordAfterRetry.status !== "failed" || failedRecordAfterRetry.processing_id === retriedSummary.processingId) {
    throw new Error("The failed paper summary record was not preserved after retry");
  }
  assertPaperSummaryRecordContract(retriedSummary.record, {
    ...summaryScope,
    processingId: retriedSummary.processingId
  }, { status: "completed", cache_disposition: "cache_miss", retry_of_processing_id: invalidProcessingId });

  const cancellationTitle = "Task 5C cancellation paper";
  await page.getByRole("button", { name: "Edit metadata" }).click();
  await page.getByLabel("Title *").fill(cancellationTitle);
  await page.getByRole("button", { name: "Save paper" }).click();
  await expect(page.getByTestId("paper-save-status")).toContainText("Paper metadata saved locally", { timeout: 15_000 });
  await expect(page.getByTestId("paper-summary-section").getByRole("button", { name: "Generate summary" })).toBeVisible({ timeout: 15_000 });
  paperTitle = cancellationTitle;

  await setPaperSummaryScenario("delayed");
  const cancellableSummary = page.getByTestId("paper-summary-section");
  await cancellableSummary.getByRole("button", { name: "Generate summary" }).click();
  const cancellationStartResponsePromise = page.waitForResponse((response) => response.url() === `${COMPANION_ORIGIN}/api/v1/workspaces/${encodeURIComponent(workspaceId)}/projects/${encodeURIComponent(task5cProjectId)}/papers/${encodeURIComponent(task5cPaperId)}/ai-summary/start` && response.request().method() === "POST");
  await page.getByRole("dialog", { name: "Generate a paper summary?" }).getByRole("button", { name: "Confirm and generate" }).click();
  const cancellationStartResponse = await cancellationStartResponsePromise;
  if (!cancellationStartResponse.ok()) {
    throw new Error(`Paper summary cancellation setup returned HTTP ${cancellationStartResponse.status()}`);
  }
  const cancellationStartPayload = await cancellationStartResponse.json();
  const cancellationProcessingId = cancellationStartPayload.record?.processing_id;
  if (typeof cancellationProcessingId !== "string" || !cancellationProcessingId) {
    throw new Error("Paper summary cancellation setup did not return a processing_id");
  }
  if (cancellationStartPayload.record?.status !== "queued") {
    throw new Error(`Paper summary cancellation setup did not begin queued: ${cancellationStartPayload.record?.status ?? "missing"}`);
  }
  await cancellableSummary.getByRole("button", { name: "Cancel summary" }).waitFor({ timeout: 15_000 });
  await cancellableSummary.getByRole("button", { name: "Cancel summary" }).click();
  const cancellationRecord = await waitForPaperSummaryTerminal(page, {
    workspaceId,
    projectId: task5cProjectId,
    paperId: task5cPaperId,
    processingId: cancellationProcessingId
  }, authorizationRef, { expectedStatus: "cancelled" });
  assertPaperSummaryRecordContract(cancellationRecord, {
    ...summaryScope,
    processingId: cancellationProcessingId
  }, { status: "cancelled", cache_disposition: "cache_miss", stale: false, invalidated: false });
  if (cancellationRecord.status !== "cancelled") {
    throw new Error(`Paper summary cancellation ${cancellationProcessingId} reached unexpected terminal state: ${cancellationRecord.status}`);
  }
  await expect(cancellableSummary.getByTestId("paper-summary-processing-status")).toContainText("cancelled", { timeout: 15_000 });

  await setPaperSummaryScenario("success");
  const cancelledRetry = await retryPaperSummaryAndWait(page, cancellableSummary, {
    workspaceId,
    projectId: task5cProjectId,
    paperId: task5cPaperId,
    processingId: cancellationProcessingId
  }, authorizationRef, "cancelled");
  assertPaperSummaryRecordContract(cancelledRetry.record, {
    ...summaryScope,
    processingId: cancelledRetry.processingId
  }, { status: "completed", cache_disposition: "cache_miss", retry_of_processing_id: cancellationProcessingId, stale: false, invalidated: false });
  const invalidateUrl = `${COMPANION_ORIGIN}/api/v1/workspaces/${encodeURIComponent(workspaceId)}/projects/${encodeURIComponent(task5cProjectId)}/papers/${encodeURIComponent(task5cPaperId)}/ai-summary/records/${encodeURIComponent(cancelledRetry.processingId)}/invalidate`;
  const invalidateResponsePromise = page.waitForResponse((response) => response.url() === invalidateUrl && response.request().method() === "POST");
  await cancellableSummary.getByRole("button", { name: "Invalidate summary" }).click();
  const invalidateResponse = await invalidateResponsePromise;
  if (!invalidateResponse.ok()) {
    throw new Error(`Paper summary invalidation returned HTTP ${invalidateResponse.status()}`);
  }
  const invalidatePayload = await invalidateResponse.json();
  if (invalidatePayload.record?.processing_id !== cancelledRetry.processingId) {
    throw new Error("Paper summary invalidation targeted a different processing record");
  }
  const invalidatedRecord = await readBrowserPaperSummaryRecord(page, {
    ...summaryScope,
    processingId: cancelledRetry.processingId
  }, authorizationRef.value);
  assertPaperSummaryRecordContract(invalidatedRecord, {
    ...summaryScope,
    processingId: cancelledRetry.processingId
  }, { status: "completed", cache_disposition: "invalidated", stale: false, invalidated: true });
  if (!invalidatedRecord.output || invalidatedRecord.output.contract_id !== "paper-summary.v1") {
    throw new Error("Paper summary invalidation removed the durable output");
  }
  const invalidatedHistoryEvent = cancellableSummary.getByTestId(`paper-summary-history-event-${cancelledRetry.processingId}`);
  await expect(invalidatedHistoryEvent).toBeVisible({ timeout: 15_000 });
  await expect(invalidatedHistoryEvent).toHaveAttribute("data-status", "completed");
  await expect(invalidatedHistoryEvent).toHaveAttribute("data-cache-disposition", "invalidated");
  await expect(invalidatedHistoryEvent).toHaveAttribute("data-invalidated", "true");
  await expect(invalidatedHistoryEvent).toContainText("Invalidated");
  const invalidationStatus = cancellableSummary.getByTestId("paper-summary-processing-status");
  await expect(invalidationStatus).toContainText("Latest request: Not current", { timeout: 15_000 });
  await expect(invalidationStatus).not.toContainText("Available");
  await expect(cancellableSummary.getByRole("button", { name: "Generate summary" })).toBeVisible({ timeout: 15_000 });
  await expect(cancellableSummary.getByRole("button", { name: "Use cached summary" })).toHaveCount(0);

  const browserStorage = await page.evaluate(() => ({
    localStorage: Object.entries(window.localStorage),
    sessionStorage: Object.entries(window.sessionStorage)
  }));
  expect(JSON.stringify(browserStorage)).not.toMatch(/summary|paper|extraction|gpt-4o-mini|synthetic-browser-summary-key/i);
  expect(await summary.textContent()).not.toContain(workspacePath);

  const summaryStartRequestsBeforeReload = summaryStartRequestCount;
  await page.reload();
  await page.getByRole("navigation", { name: "Primary navigation" }).waitFor({ timeout: 10_000 });
  await pairBrowser(page);
  await openBrowserWorkspace(page, workspacePath);
  await openProjectPapers(page, task5cProjectName);
  await openPersistedPaper(page, paperTitle, { edit: false, paperId: task5cPaperId });
  const reopenedSummary = page.getByTestId("paper-summary-section");
  const reopenedHistoryRecords = await readBrowserPaperSummaryHistory(page, summaryScope, authorizationRef.value);
  const reopenedHistoryById = new Map(reopenedHistoryRecords.map((record) => [record.processing_id, record]));
  const reopenedInitial = reopenedHistoryById.get(initialStarted.processing_id);
  const reopenedCached = reopenedHistoryById.get(cachedStarted.processing_id);
  const reopenedFailed = reopenedHistoryById.get(invalidProcessingId);
  const reopenedFailedRetry = reopenedHistoryById.get(retriedSummary.processingId);
  const reopenedCancelled = reopenedHistoryById.get(cancellationProcessingId);
  const reopenedCancelledRetry = reopenedHistoryById.get(cancelledRetry.processingId);
  for (const [label, record] of [
    ["initial", reopenedInitial],
    ["cache", reopenedCached],
    ["failed", reopenedFailed],
    ["failed retry", reopenedFailedRetry],
    ["cancelled", reopenedCancelled],
    ["cancelled retry", reopenedCancelledRetry]
  ]) {
    if (!record) {
      throw new Error(`Reload lost the durable ${label} paper summary record`);
    }
  }
  assertPaperSummaryRecordContract(reopenedInitial, { ...summaryScope, processingId: initialStarted.processing_id }, { status: "completed", cache_disposition: "cache_miss", stale: true, invalidated: false });
  assertPaperSummaryRecordContract(reopenedCached, { ...summaryScope, processingId: cachedStarted.processing_id }, { status: "completed", cache_disposition: "cache_hit", stale: true, invalidated: false, original_processing_id: initialStarted.processing_id });
  assertPaperSummaryRecordContract(reopenedFailed, { ...summaryScope, processingId: invalidProcessingId }, { status: "failed", cache_disposition: "cache_miss", stale: true, invalidated: false });
  assertPaperSummaryRecordContract(reopenedFailedRetry, { ...summaryScope, processingId: retriedSummary.processingId }, { status: "completed", cache_disposition: "cache_miss", stale: true, invalidated: false, retry_of_processing_id: invalidProcessingId });
  assertPaperSummaryRecordContract(reopenedCancelled, { ...summaryScope, processingId: cancellationProcessingId }, { status: "cancelled", cache_disposition: "cache_miss", stale: false, invalidated: false });
  assertPaperSummaryRecordContract(reopenedCancelledRetry, { ...summaryScope, processingId: cancelledRetry.processingId }, { status: "completed", cache_disposition: "invalidated", stale: false, invalidated: true, retry_of_processing_id: cancellationProcessingId });
  if (summaryStartRequestCount !== summaryStartRequestsBeforeReload) {
    throw new Error("Paper summary reload started a new processing request");
  }
  const reopenedHistory = reopenedSummary.getByTestId("paper-summary-history");
  await expect(reopenedHistory).toHaveAttribute("data-history-visible-limit", "6", { timeout: 15_000 });
  await expect(reopenedHistory).toHaveAttribute("data-history-total-count", String(reopenedHistoryRecords.length));
  await expect(reopenedHistory.getByTestId(`paper-summary-history-event-${cancelledRetry.processingId}`)).toHaveAttribute("data-status", "completed");
  await expect(reopenedHistory.getByTestId(`paper-summary-history-event-${cancelledRetry.processingId}`)).toHaveAttribute("data-cache-disposition", "invalidated");
  await expect(reopenedHistory.getByTestId(`paper-summary-history-event-${cancelledRetry.processingId}`)).toHaveAttribute("data-invalidated", "true");
  await expect(reopenedHistory.getByTestId(`paper-summary-history-event-${cancelledRetry.processingId}`)).toContainText("Invalidated");
  const reopenedInvalidationStatus = reopenedSummary.getByTestId("paper-summary-processing-status");
  await expect(reopenedInvalidationStatus).toContainText("Latest request: Not current", { timeout: 15_000 });
  await expect(reopenedInvalidationStatus).not.toContainText("Available");
  await expect(reopenedSummary.getByRole("button", { name: "Generate summary" })).toBeVisible({ timeout: 15_000 });
  await expect(reopenedSummary.getByRole("button", { name: "Use cached summary" })).toHaveCount(0);
  await expect(reopenedSummary.getByTestId("paper-summary-output")).toHaveCount(0);
  await expect(reopenedSummary).not.toContainText(providerKey);
  await expect(reopenedSummary).not.toContainText(workspacePath);
  page.off("request", observeSummaryStart);
}

async function verifyTask3FNotesFlow(page) {
  await page.getByRole("button", { name: "Open Notes" }).click();
  await page.getByRole("heading", { name: /notes$/i }).waitFor({ timeout: 10_000 });
  await expect(page.getByText("No notes yet.")).toBeVisible();
  await page.getByRole("button", { name: "Add note" }).click();
  await page.getByLabel("Title *").fill("Project observation");
  await page.getByRole("textbox", { name: /Body/ }).fill("A durable project observation.");
  await page.getByRole("button", { name: "Create note" }).click();
  await expect(page.getByTestId("note-save-status")).toContainText("Note saved", { timeout: 10_000 });
  await page.getByRole("button", { name: "Back", exact: true }).first().click();
  await page.getByTestId("project-overview").waitFor({ timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "1 note" })).toBeVisible();

  await page.getByRole("button", { name: "Open Papers" }).click();
  await page.getByRole("heading", { name: /browser project papers/ }).waitFor({ timeout: 10_000 });
  await openPersistedPaper(page, "Updated browser-persisted paper record");
  await page.getByRole("button", { name: "Paper notes" }).click();
  await page.getByRole("heading", { name: /notes$/i }).waitFor({ timeout: 10_000 });
  await expect(page.getByText("No notes yet.")).toBeVisible();
  await page.getByRole("button", { name: "Add note" }).click();
  await page.getByLabel("Title *").fill("Paper observation");
  await page.getByRole("textbox", { name: /Body/ }).fill("A durable paper observation.");
  await page.getByRole("button", { name: "Create note" }).click();
  await expect(page.getByTestId("note-save-status")).toContainText("Note saved", { timeout: 10_000 });
  await page.getByRole("button", { name: "Back", exact: true }).first().click();
  await page.getByRole("heading", { name: /browser project papers/ }).waitFor({ timeout: 15_000 });
  await openPersistedPaper(page, "Updated browser-persisted paper record");
  await page.getByRole("button", { name: "Paper notes" }).click();
  await page.getByRole("button", { name: "Open note" }).click();
  await page.getByLabel("Title *").fill("Updated paper observation");
  await page.getByRole("button", { name: "Save note" }).click();
  await expect(page.getByTestId("note-save-status")).toContainText("Note saved", { timeout: 10_000 });
  await page.getByRole("button", { name: "Back", exact: true }).first().click();
  await page.getByRole("button", { name: "Back to Project Overview" }).click();
  await page.getByTestId("project-overview").waitFor({ timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "2 notes" })).toBeVisible();
  await expect(page.getByText("Updated paper observation", { exact: true })).toBeVisible();
}

async function verifyBrowserLoopback(workspace, fixtures) {
  const { workspacePath } = workspace;
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined
  });
  try {
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();
    const browserAuthorization = { value: null };
    const captureBrowserAuthorization = (request) => {
      if (request.url().startsWith(COMPANION_ORIGIN)) {
        const headers = request.headers();
        const authorization = headers.authorization || headers.Authorization;
        if (authorization) {
          browserAuthorization.value = authorization;
        }
      }
    };
    page.on("request", captureBrowserAuthorization);
    await page.goto(STATIC_SPIKE_ORIGIN);
    await page.getByRole("navigation", { name: "Primary navigation" }).waitFor({ timeout: 10_000 });
    const connectionStatus = page.getByTestId("companion-connection-status");
    await connectionStatus.waitFor({ timeout: 10_000 });
    await expect(connectionStatus).toHaveAttribute("role", "status");
    await expect(connectionStatus).toHaveAttribute("aria-live", "polite");
    await expect(connectionStatus).toHaveAttribute("data-connection-state", "connected");
    await openOnboarding(page);
    const capabilities = page.getByTestId("companion-capabilities");
    await capabilities.waitFor({ timeout: 10_000 });
    const capabilitiesText = await capabilities.textContent();
    if (!capabilitiesText?.includes("pairing") || !capabilitiesText.includes("keychain_spike")) {
      throw new Error(`PWA did not process expected companion capabilities: ${capabilitiesText}`);
    }
    await verifyTask3DProjectOverviewFlow(page, workspacePath, fixtures, { onboardingOpen: true });
    await verifyTask4DPaperMetadataFlow(page);
    await verifyTask4CDuplicateFlow(page, workspacePath, fixtures);
    await verifyTask5AProviderFlow(page, workspacePath);
    await verifyTask5BProcessingFlow(page, workspacePath);
    await verifyTask5CSummaryFlow(page, workspace, fixtures, browserAuthorization);
  } finally {
    await browser.close();
  }
}

async function main() {
  const python = process.env.PYTHON_BIN ?? "python3";

  start("companion", python, [
    "-m",
    "uvicorn",
    "research_intelligence_companion.app:create_app",
    "--factory",
    "--host",
    "127.0.0.1",
    "--port",
    "8765"
  ], companionEnv);

  await startStaticHttpsServer();
  await waitFor(`${COMPANION_ORIGIN}/api/v1/health`);
  await verifyOriginContract();
  let seeded;
  const fixtureDirectory = mkdtempSync(join(tmpdir(), "research-intelligence-task4a-pdf-fixtures-"));
  const fixtures = {
    firstPath: join(fixtureDirectory, "task4a-first.pdf"),
    secondPath: join(fixtureDirectory, "task4a-second.pdf"),
    summaryPath: join(fixtureDirectory, "task5c-summary.pdf")
  };
  writeFileSync(fixtures.firstPath, pdfBytes(["Task 4B first page", "Task 4B second page"]));
  writeFileSync(fixtures.secondPath, pdfBytes(["Task 4B replacement page"]));
  writeFileSync(fixtures.summaryPath, pdfBytes(["Task 5C summary source", "Task 5C bounded local summary fixture"]));
  try {
    seeded = await seedTask3DWorkspace();
    await verifyBrowserLoopback(seeded, fixtures);
    console.log("HTTPS static PWA loopback and Task 4D structured paper metadata flow verified");
  } finally {
    if (seeded) {
      rmSync(seeded.workspacePath, { recursive: true, force: true });
    }
    rmSync(fixtureDirectory, { recursive: true, force: true });
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    if (httpsServer) {
      httpsServer.close();
    }
    rmSync(deviceDataRoot, { recursive: true, force: true });
    for (const child of processes.reverse()) {
      child.kill("SIGTERM");
    }
  });
