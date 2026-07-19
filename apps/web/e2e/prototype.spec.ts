import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

const captureDirectory = process.env.VISUAL_CAPTURE_DIR ?? path.resolve(process.cwd(), "../../test-results/prototype-captures");

async function capture(page: Page, name: string) {
  mkdirSync(captureDirectory, { recursive: true });
  await page.screenshot({ path: path.join(captureDirectory, `${name}.png`), fullPage: true });
}

async function goTo(page: Page, label: string) {
  await page.getByRole("link", { name: label }).click();
  await expect(page.locator(".topbar-title span")).toContainText(label);
}

test("captures the approved prototype screens", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: /primary navigation/i })).toBeVisible();
  await capture(page, "home");

  await goTo(page, "Discovery");
  await capture(page, "discovery-table");
  await page.getByTestId("discovery-cards-view").click();
  await capture(page, "discovery-cards");
  await page.getByTestId("discovery-field-view").click();
  await capture(page, "paper-field");

  await goTo(page, "Reading Hub");
  await capture(page, "reading-hub");
  await page.getByRole("button", { name: "Start reading" }).click();
  await capture(page, "focus-reading");

  await goTo(page, "Projects");
  await page.getByRole("button", { name: "Open project" }).first().click();
  await capture(page, "research-profile");

  await goTo(page, "Synthesis");
  await capture(page, "synthesis");
  await goTo(page, "Research Gaps");
  await capture(page, "research-gaps");
  await goTo(page, "Settings");
  await capture(page, "settings");
});

test.describe("responsive containment", () => {
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 1280, height: 800 },
    { width: 1024, height: 768 }
  ]) {
    test(`${viewport.width}x${viewport.height} keeps the shell within the viewport`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto("/#discovery");
      await expect(page.getByRole("heading", { name: /papers matched your project/i })).toBeVisible();
      const containment = await page.evaluate(() => {
        const overflow = [...document.querySelectorAll<HTMLElement>(".app-shell, .main-content, .page, .card, .button, svg")].map((element) => ({
          tag: element.tagName,
          right: element.getBoundingClientRect().right,
          bottom: element.getBoundingClientRect().bottom,
          viewportWidth: window.innerWidth
        })).filter((item) => item.right > item.viewportWidth + 1);
        return { documentWidth: document.documentElement.scrollWidth, viewportWidth: window.innerWidth, overflowCount: overflow.length };
      });
      expect(containment.documentWidth).toBeLessThanOrEqual(containment.viewportWidth + 1);
      expect(containment.overflowCount).toBe(0);
    });
  }
});
