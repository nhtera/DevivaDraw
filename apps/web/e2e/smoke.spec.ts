import { test, expect } from "@playwright/test";

test("app shell loads with title and the composed <DevivaDraw/> canvas mounted", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("Deviva Draw");
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
  await expect(page.getByTestId("toolbar-select-tool")).toBeVisible();
});
