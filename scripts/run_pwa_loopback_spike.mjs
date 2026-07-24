import { chromium, expect } from "@playwright/test";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:https";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import process from "node:process";

const COMPANION_ORIGIN = "http://127.0.0.1:8765";
const STATIC_SPIKE_ORIGIN = "https://127.0.0.1:4443";
const PRODUCTION_ORIGIN = "https://emmywong0530.github.io";
const INVALID_ORIGIN = "https://example.invalid";
const DIST_DIR = resolve("apps/web/dist");

const companionEnv = {
  ...process.env,
  PYTHONPATH: "companion/src",
  PYTHONUNBUFFERED: "1",
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

async function seedTask3CWorkspace() {
  const session = await pairCompanionDirectly();
  const workspacePath = mkdtempSync(join(tmpdir(), "research-intelligence-task3c-browser-"));
  const workspace = await jsonRequest("/api/v1/workspaces/create", {
    method: "POST",
    headers: { Authorization: `Bearer ${session.session_token}` },
    body: JSON.stringify({ path: workspacePath, name: "Task 3C browser workspace" })
  });
  const workspaceId = workspace.workspace_id;
  const projectId = "project-task3c-browser";
  const now = new Date().toISOString();
  await jsonRequest(`/api/v1/workspaces/${workspaceId}/records/projects/${projectId}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${session.session_token}` },
    body: JSON.stringify({
      record: {
        schema_version: "m2.v1",
        project_id: projectId,
        name: "Task 3C browser project",
        natural_language_research_idea: "Verify transparent profile proposals in a disposable browser flow.",
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
          proposal_id: "proposal-task3c-browser",
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
  return { workspacePath, workspaceId };
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

async function pairBrowser(page) {
  await page.getByRole("button", { name: "Onboarding" }).click();
  await page.getByTestId("companion-capabilities").waitFor({ timeout: 10_000 });
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

async function verifyTask3CProfileFlow(page, workspacePath) {
  await pairBrowser(page);
  await openBrowserWorkspace(page, workspacePath);
  await page.getByRole("link", { name: "Projects" }).click();
  await page.getByRole("heading", { name: "Projects saved locally" }).waitFor({ timeout: 10_000 });
  await page.getByRole("button", { name: /Task 3C browser project/ }).click();
  await page.getByRole("button", { name: "Research Profile" }).click();
  await page.getByRole("heading", { name: "Profile change proposals" }).waitFor({ timeout: 10_000 });
  await page.getByRole("button", { name: "Accept proposal" }).click();
  await page.getByRole("button", { name: "Apply proposal change" }).click();
  await expect(page.getByText("accepted", { exact: true })).toBeVisible({ timeout: 15_000 });

  await page.reload();
  await page.getByRole("navigation", { name: "Primary navigation" }).waitFor({ timeout: 10_000 });
  await pairBrowser(page);
  await openBrowserWorkspace(page, workspacePath);
  await page.getByRole("link", { name: "Projects" }).click();
  await page.getByRole("heading", { name: "Projects saved locally" }).waitFor({ timeout: 10_000 });
  await page.getByRole("button", { name: /Task 3C browser project/ }).click();
  await page.getByRole("button", { name: "Research Profile" }).click();
  await expect(page.getByText("accepted", { exact: true })).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "Reverse proposal" }).click();
  await page.getByRole("button", { name: "Reverse proposal", exact: true }).last().click();
  await expect(page.getByText("reversed", { exact: true })).toBeVisible({ timeout: 15_000 });

  await page.reload();
  await page.getByRole("navigation", { name: "Primary navigation" }).waitFor({ timeout: 10_000 });
  await pairBrowser(page);
  await openBrowserWorkspace(page, workspacePath);
  await page.getByRole("link", { name: "Projects" }).click();
  await page.getByRole("heading", { name: "Projects saved locally" }).waitFor({ timeout: 10_000 });
  await page.getByRole("button", { name: /Task 3C browser project/ }).click();
  await page.getByRole("button", { name: "Research Profile" }).click();
  await expect(page.getByText("reversed", { exact: true })).toBeVisible({ timeout: 10_000 });
}

async function verifyBrowserLoopback(workspacePath) {
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
    const capabilities = page.getByTestId("companion-capabilities");
    await capabilities.waitFor({ timeout: 10_000 });
    const capabilitiesText = await capabilities.textContent();
    if (!capabilitiesText?.includes("pairing") || !capabilitiesText.includes("keychain_spike")) {
      throw new Error(`PWA did not process expected companion capabilities: ${capabilitiesText}`);
    }
    await verifyTask3CProfileFlow(page, workspacePath);
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
  const seeded = await seedTask3CWorkspace();
  try {
    await verifyBrowserLoopback(seeded.workspacePath);
    console.log("HTTPS static PWA loopback and Task 3C profile flow verified");
  } finally {
    rmSync(seeded.workspacePath, { recursive: true, force: true });
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
    for (const child of processes.reverse()) {
      child.kill("SIGTERM");
    }
  });
