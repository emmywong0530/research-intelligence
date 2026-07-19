import { expect, test } from "@playwright/test";

test("renders static-compatible shell", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: /primary navigation/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /open companion connection setup/i })).toBeVisible();
  await expect(page.getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");
});
