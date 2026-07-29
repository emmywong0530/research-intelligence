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
    return { workspacePath, workspaceId, duplicateProjectId };
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

async function openPersistedPaper(page, title, { edit = true } = {}) {
  const paperRow = page.getByRole("listitem").filter({ has: page.getByText(title, { exact: true }) });
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
  await expect(page.getByTestId("paper-source-empty")).toBeVisible({ timeout: 10_000 });
  await page.getByTestId("paper-source-file-input").setInputFiles(fixturePath);
  await expect(page.getByTestId("paper-source-preview")).toContainText(fixtureName);
  await page.getByRole("button", { name: "Import PDF" }).click();
  await expect(page.getByTestId("paper-source-status")).toContainText(fixtureName, { timeout: 15_000 });
  await expect(page.getByTestId("paper-source-status")).toContainText(sha256File(fixturePath), { timeout: 15_000 });
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
  await page.getByRole("button", { name: "Manage local PDF" }).click();
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

async function verifyBrowserLoopback(workspacePath, fixtures) {
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined
  });
  try {
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();
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
    secondPath: join(fixtureDirectory, "task4a-second.pdf")
  };
  writeFileSync(fixtures.firstPath, pdfBytes(["Task 4B first page", "Task 4B second page"]));
  writeFileSync(fixtures.secondPath, pdfBytes(["Task 4B replacement page"]));
  try {
    seeded = await seedTask3DWorkspace();
    await verifyBrowserLoopback(seeded.workspacePath, fixtures);
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
