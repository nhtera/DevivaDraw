import { test, expect } from "@playwright/test";

test("app shell loads with title and engine version", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("Deviva Draw");
  await expect(page.getByTestId("engine-version")).toContainText("engine");
});
