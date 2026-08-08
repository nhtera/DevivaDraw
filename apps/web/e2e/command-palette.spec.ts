import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
});

test("typing a tool-shortcut letter into the open command palette's search box does not leak to the global shortcut resolver", async ({ page }) => {
  // Select tool is active by default.
  await expect(page.getByTestId("toolbar-select-tool")).toHaveAttribute("aria-pressed", "true");

  await page.keyboard.press("Control+k");
  const search = page.getByTestId("command-palette-search");
  await expect(search).toBeVisible();

  // Real keystrokes (not `.fill()`) — dispatches genuine keydown events, the exact path that used to
  // leak past the dialog and switch tools behind it.
  await search.pressSequentially("r");

  // The letter landed in the input...
  await expect(search).toHaveValue("r");
  // ...and did NOT reach the global shortcut resolver: the active tool is still "select", not "rectangle".
  await expect(page.getByTestId("toolbar-select-tool")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("toolbar-rectangle-tool")).toHaveAttribute("aria-pressed", "false");
});

test("Escape still closes the command palette while global-shortcut suppression is active", async ({ page }) => {
  await page.keyboard.press("Control+k");
  await expect(page.getByTestId("command-palette")).toBeVisible();

  await page.keyboard.press("Escape");

  await expect(page.getByTestId("command-palette")).not.toBeVisible();
});
