import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import process from "node:process";

const companionEnv = {
  ...process.env,
  PYTHONPATH: "companion/src",
  RI_ALLOWED_ORIGINS: "http://127.0.0.1:4173",
  RI_HOST: "127.0.0.1",
  RI_PORT: "8765"
};

const processes = [];

function start(name, command, args, env = process.env) {
  const child = spawn(command, args, { env, stdio: ["ignore", "pipe", "pipe"] });
  processes.push(child);
  child.stdout.on("data", (data) => process.stdout.write(`[${name}] ${data}`));
  child.stderr.on("data", (data) => process.stderr.write(`[${name}] ${data}`));
  return child;
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
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function main() {
  const pnpm = process.env.PNPM_BIN ?? "pnpm";
  const python = process.env.PYTHON_BIN ?? "python3";

  start("companion", python, ["-m", "uvicorn", "research_intelligence_companion.app:create_app", "--factory", "--host", "127.0.0.1", "--port", "8765"], companionEnv);
  start(
    "web",
    pnpm,
    ["--dir", "apps/web", "exec", "vite", "preview", "--host", "127.0.0.1", "--port", "4173"],
    process.env
  );

  await waitFor("http://127.0.0.1:8765/api/v1/health");
  await waitFor("http://127.0.0.1:4173");

  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined
  });
  const page = await browser.newPage();
  await page.goto("http://127.0.0.1:4173");
  await page.getByText(/Loopback companion online/).waitFor({ timeout: 10_000 });
  await page.getByRole("button", { name: /Start Pairing/ }).click();
  await page.getByDisplayValue(/[0-9]{6}/).waitFor();
  await page.getByRole("button", { name: /Complete Pairing/ }).click();
  await page.getByText(/Session token is held only in component state/).waitFor();
  await browser.close();
  console.log("PWA loopback spike verified");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    for (const child of processes.reverse()) {
      child.kill("SIGTERM");
    }
  });
