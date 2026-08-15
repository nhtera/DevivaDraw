import { test, expect } from "@playwright/test";

/**
 * Mermaid to diagram (Excalidraw parity, no LLM): paste flowchart text, see a live preview, insert
 * editable shapes. Invalid/unsupported input shows an inline error and disables Insert.
 */

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.getByTestId("deviva-draw-root")).toBeVisible();
});

test("inserting a Mermaid flowchart creates selected, editable elements", async ({ page }) => {
  await page.getByTestId("top-bar-menu").click();
  await page.getByTestId("main-menu-mermaid").click();
  await expect(page.getByTestId("mermaid-dialog")).toBeVisible();

  await page.getByTestId("mermaid-input").fill("flowchart TD\n A[One] --> B[Two]\n B --> C[Three]");
  // Live preview renders the parsed diagram before inserting.
  await expect(page.getByTestId("mermaid-preview")).toBeVisible();
  await expect(page.getByTestId("mermaid-insert")).toBeEnabled();
  await page.getByTestId("mermaid-insert").click();

  // The dialog closes and the generated diagram is on the canvas, selected (undoable).
  await expect(page.getByTestId("mermaid-dialog")).toHaveCount(0);
  await expect(page.getByTestId("top-bar-undo")).toBeEnabled();
  await expect(page.locator('[data-testid^="layer-action-"]').first()).toBeVisible();

  // One undo removes the whole inserted diagram in a single step (it was one history batch).
  await page.getByTestId("top-bar-undo").click();
  await expect(page.locator('[data-testid^="layer-action-"]')).toHaveCount(0);
});

test("a state diagram previews and inserts as editable elements", async ({ page }) => {
  await page.getByTestId("top-bar-menu").click();
  await page.getByTestId("main-menu-mermaid").click();
  await expect(page.getByTestId("mermaid-dialog")).toBeVisible();

  await page.getByTestId("mermaid-input").fill("stateDiagram-v2\n [*] --> Still\n Still --> Moving : go\n Moving --> [*]");
  await expect(page.getByTestId("mermaid-preview")).toBeVisible();
  await expect(page.getByTestId("mermaid-insert")).toBeEnabled();
  await page.getByTestId("mermaid-insert").click();

  await expect(page.getByTestId("mermaid-dialog")).toHaveCount(0);
  await expect(page.locator('[data-testid^="layer-action-"]').first()).toBeVisible();
});

test("a sequence diagram previews and inserts as editable elements", async ({ page }) => {
  await page.getByTestId("top-bar-menu").click();
  await page.getByTestId("main-menu-mermaid").click();
  await expect(page.getByTestId("mermaid-dialog")).toBeVisible();

  await page.getByTestId("mermaid-input").fill("sequenceDiagram\n participant A as Alice\n participant B as Bob\n A->>+B: request\n B-->>-A: response\n loop retry\n A->>B: ping\n end");
  await expect(page.getByTestId("mermaid-preview")).toBeVisible();
  await expect(page.getByTestId("mermaid-insert")).toBeEnabled();
  await page.getByTestId("mermaid-insert").click();

  await expect(page.getByTestId("mermaid-dialog")).toHaveCount(0);
  await expect(page.locator('[data-testid^="layer-action-"]').first()).toBeVisible();
});

test("an unsupported diagram type rasterizes via the mermaid fallback and inserts as an image", async ({ page }) => {
  await page.getByTestId("top-bar-menu").click();
  await page.getByTestId("main-menu-mermaid").click();
  await expect(page.getByTestId("mermaid-dialog")).toBeVisible();

  await page.getByTestId("mermaid-input").fill('pie title Pets\n "Dogs": 3\n "Cats": 2');
  // The lazily-loaded mermaid lib renders it to a PNG preview; give the async import + render room.
  await expect(page.getByTestId("mermaid-preview").locator("img")).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId("mermaid-insert")).toBeEnabled();
  await page.getByTestId("mermaid-insert").click();

  await expect(page.getByTestId("mermaid-dialog")).toHaveCount(0);
  await expect(page.locator('[data-testid^="layer-action-"]').first()).toBeVisible();
});

test("text-to-diagram generates Mermaid via the user's key and feeds the normal insert flow", async ({ page }) => {
  // Stub the provider: the request must carry the user's key and the direct-browser-access opt-in.
  let sawKey = "";
  let sawDirectAccess = "";
  await page.route("https://api.anthropic.com/v1/messages", async (route) => {
    sawKey = route.request().headers()["x-api-key"] ?? "";
    sawDirectAccess = route.request().headers()["anthropic-dangerous-direct-browser-access"] ?? "";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ content: [{ type: "text", text: "flowchart TD\n  A[Signup] --> B{Verified?}\n  B -->|yes| C[Onboard]\n  B -->|no| D[Reject]" }] }),
    });
  });

  await page.getByTestId("top-bar-menu").click();
  await page.getByTestId("main-menu-mermaid").click();
  await page.getByTestId("mermaid-ai-prompt").fill("signup flow with email verification");
  await page.getByTestId("mermaid-ai-key").fill("sk-ant-test");
  await page.getByTestId("mermaid-ai-generate").click();

  // The generated source lands in the editor, previews, and inserts like hand-written Mermaid.
  await expect(page.getByTestId("mermaid-input")).toHaveValue(/Signup/);
  expect(sawKey).toBe("sk-ant-test");
  expect(sawDirectAccess).toBe("true");
  await expect(page.getByTestId("mermaid-insert")).toBeEnabled();
  await page.getByTestId("mermaid-insert").click();
  await expect(page.getByTestId("mermaid-dialog")).toHaveCount(0);
  await expect(page.getByTestId("top-bar-undo")).toBeEnabled();

  // The key is remembered for next time (this browser only), and the input collapses to a change link.
  expect(await page.evaluate(() => localStorage.getItem("devivadraw:ai-key:v1"))).toBe("sk-ant-test");
  await page.getByTestId("top-bar-menu").click();
  await page.getByTestId("main-menu-mermaid").click();
  await expect(page.getByTestId("mermaid-ai-change-key")).toBeVisible();
  await expect(page.getByTestId("mermaid-ai-key")).toHaveCount(0);
});

test("a rejected API key shows the unauthorized error and generates nothing", async ({ page }) => {
  await page.route("https://api.anthropic.com/v1/messages", (route) => route.fulfill({ status: 401, contentType: "application/json", body: "{}" }));

  await page.getByTestId("top-bar-menu").click();
  await page.getByTestId("main-menu-mermaid").click();
  const before = await page.getByTestId("mermaid-input").inputValue();
  await page.getByTestId("mermaid-ai-prompt").fill("anything");
  await page.getByTestId("mermaid-ai-key").fill("sk-bad");
  await page.getByTestId("mermaid-ai-generate").click();

  await expect(page.getByTestId("mermaid-ai-error")).toBeVisible();
  await expect(page.getByTestId("mermaid-input")).toHaveValue(before); // source untouched
});
