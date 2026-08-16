/**
 * Desktop document lifecycle over the editor's imperative handle: window title + dirty dot,
 * native menu (File handlers this phase; Edit routes through the same action registry as the
 * in-shell chrome), recents, the unsaved-close guard, and external opens (file association,
 * second instance, OS drag-drop) with silent scratch preservation to a recovery file.
 *
 * Every menu action dispatches through `DevivaDrawHandle.runAction` — the exact `ActionRegistry`
 * path the in-shell menu/command palette use — so native and in-app chrome can never drift.
 */
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Menu, MenuItem, PredefinedMenuItem, Submenu } from "@tauri-apps/api/menu";
import { appDataDir, join } from "@tauri-apps/api/path";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ask, message } from "@tauri-apps/plugin-dialog";
import type { DevivaDrawHandle, DocumentState, SaveDocumentOutcome } from "@deviva-draw/react";

interface PickedFile {
  path: string;
  name: string;
  text: string;
}

interface RecentEntry {
  path: string;
  name: string;
}

const AUTOSAVE_KEY = "devivadraw:autosave:v1";
const MAX_RECENTS = 10;
const KEEP_RECOVERY_FILES = 10;

export class DocumentHost {
  private state: DocumentState = { path: null, name: "Untitled", dirty: false };
  private getHandle: () => DevivaDrawHandle | null = () => null;
  private recents: RecentEntry[] = [];
  private recentsPath: string | null = null;
  private started = false;
  private closing = false;
  private closePromptInFlight = false;
  /** Serializes external opens — two rapid open-file-requests must not race one runtime rebuild. */
  private openQueue: Promise<void> = Promise.resolve();
  /** Every menu/item resource of the CURRENT app menu — closed on rebuild (Tauri resources are not GC'd; leaking them grows the Rust resource table for the app's whole lifetime). */
  private menuResources: Array<{ close(): Promise<void> }> = [];

  /** Stable prop for `<DevivaDraw onDocumentStateChange/>` — fires synchronously on every transition. */
  readonly onDocumentStateChange = (state: DocumentState): void => {
    this.state = state;
    void this.syncTitle();
  };

  bindHandle(getHandle: () => DevivaDrawHandle | null): void {
    this.getHandle = getHandle;
  }

  /** One-shot startup: menu, recents, external-open listeners, close guard, ready handshake. */
  async start(): Promise<void> {
    if (this.started) return; // React StrictMode double-invokes effects
    this.started = true;

    this.recentsPath = await join(await appDataDir(), "recents.json");
    await this.loadRecents();
    await this.rebuildMenu();
    await this.syncTitle();

    await listen<PickedFile>("open-file-request", (event) => this.enqueueOpen(event.payload));
    await listen<{ name: string; mimeType: string; dataBase64: string; x: number; y: number }>("insert-image-request", (event) => this.insertDroppedImage(event.payload));
    // Handshake AFTER the listener exists — Rust buffers anything delivered before this call.
    const pending = await invoke<PickedFile[]>("frontend_ready");
    if (pending[0]) this.enqueueOpen(pending[0]);
    if (pending.length > 1) this.toast(`Opened ${pending[0]!.name} — ${pending.length - 1} more file(s) were not opened (one document per window).`);

    void getCurrentWindow().onCloseRequested(async (event) => {
      if (this.closing || !this.state.dirty) return; // clean → let the close proceed
      event.preventDefault();
      if (this.closePromptInFlight) return; // a prompt is already up — don't stack another
      this.closePromptInFlight = true;
      try {
        await this.guardedClose();
      } finally {
        this.closePromptInFlight = false;
      }
    });
  }

  /**
   * The ONE unsaved-changes gate for every app-exit path (window close, Cmd+W, Cmd+Q — and the
   * updater's restart flow later MUST call this too). Prompts, optionally saves, then destroys
   * the window; returns without closing on Cancel or a failed/canceled save.
   */
  async guardedClose(): Promise<void> {
    const choice = await invoke<string>("prompt_unsaved", { name: this.state.name });
    if (choice === "cancel") return;
    if (choice === "save") {
      const outcome = await this.saveFlow(false);
      if (outcome !== "saved") return; // canceled or failed → stay open, stay dirty
    }
    this.closing = true;
    await getCurrentWindow().destroy();
  }

  /** Chains an external open behind any in-flight one — order preserved, no runtime-rebuild races. */
  private enqueueOpen(file: PickedFile): void {
    this.openQueue = this.openQueue.then(() => this.openExternal(file)).catch((error) => console.error("deviva-desktop: external open failed", error));
  }

  /** Save / Save-As with the failure contract: an error keeps dirty state and offers Save-As. */
  private async saveFlow(saveAs: boolean): Promise<SaveDocumentOutcome> {
    const handle = this.getHandle();
    if (!handle) return "canceled";
    const outcome = await handle.saveDocument({ saveAs });
    if (typeof outcome === "object") {
      const retryAs = await ask(`Saving "${this.state.name}" failed:\n${outcome.error}\n\nSave to a different location instead?`, {
        title: "Save Failed",
        kind: "error",
        okLabel: "Save As…",
        cancelLabel: "Cancel",
      });
      if (retryAs) return this.saveFlow(true);
      return outcome;
    }
    if (outcome === "saved" && this.state.path) await this.addRecent({ path: this.state.path, name: this.state.name });
    return outcome;
  }

  /** External open (file assoc / drag-drop / second instance): preserve unsaved scratch silently, then open. */
  private async openExternal(file: PickedFile): Promise<void> {
    const handle = await this.waitForHandle();
    if (!handle) return;

    await this.preserveScratchIfNeeded(file.path);

    if (!handle.openDocument(file.text, file.path)) {
      await message(`"${file.name}" is not a readable Deviva Draw document.`, { title: "Open Failed", kind: "error" });
      await this.removeRecent(file.path); // a recent that stopped parsing gets pruned
      return;
    }
    await this.addRecent({ path: file.path, name: file.name });
  }

  /**
   * Auto-preserve (no blocking prompt, by design): if the autosave slot holds content that never
   * had a file (`originPath: null`) or has unsaved edits for a DIFFERENT file, snapshot the raw
   * slot to a timestamped recovery file in app-data and say so in a dismissible toast.
   */
  private async preserveScratchIfNeeded(incomingPath: string): Promise<void> {
    try {
      const raw = window.localStorage.getItem(AUTOSAVE_KEY);
      if (!raw) return;
      const doc = JSON.parse(raw) as { originPath?: string | null; unsaved?: boolean; pages?: Array<{ scene?: { elements?: Array<{ isDeleted?: boolean }> } }>; elements?: Array<{ isDeleted?: boolean }> };
      const elements = doc.pages ? doc.pages.flatMap((page) => page.scene?.elements ?? []) : (doc.elements ?? []);
      const hasContent = elements.some((element) => !element.isDeleted);
      const originPath = doc.originPath ?? null;
      const needsPreserve = hasContent && originPath !== incomingPath && (originPath === null || doc.unsaved === true);
      if (!needsPreserve) return;

      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const recoveryPath = await join(await appDataDir(), `recovery-${stamp}.devivadraw`);
      await invoke("write_allowed_file", { path: recoveryPath, text: raw });
      await invoke("prune_recovery_files", { keep: KEEP_RECOVERY_FILES });
      this.toast(`Unsaved work was preserved to ${recoveryPath.split(/[/\\]/).pop() ?? "a recovery file"} (in the app data folder).`);
    } catch (error) {
      console.error("deviva-desktop: scratch preservation failed (continuing with the open)", error);
    }
  }

  private async syncTitle(): Promise<void> {
    const dot = this.state.dirty ? "• " : "";
    await getCurrentWindow().setTitle(`${dot}${this.state.name} — Deviva Draw`);
  }

  // --- recents -------------------------------------------------------------------------------

  private async loadRecents(): Promise<void> {
    try {
      const raw = await invoke<string>("read_allowed_file", { path: this.recentsPath });
      const parsed = JSON.parse(raw) as unknown;
      this.recents = Array.isArray(parsed) ? parsed.filter((entry): entry is RecentEntry => typeof entry?.path === "string" && typeof entry?.name === "string").slice(0, MAX_RECENTS) : [];
    } catch {
      this.recents = []; // first run — no file yet
    }
  }

  private async persistRecents(): Promise<void> {
    if (!this.recentsPath) return;
    try {
      await invoke("write_allowed_file", { path: this.recentsPath, text: JSON.stringify(this.recents, null, 2) });
    } catch (error) {
      console.error("deviva-desktop: could not persist recents", error);
    }
  }

  private async addRecent(entry: RecentEntry): Promise<void> {
    this.recents = [entry, ...this.recents.filter((existing) => existing.path !== entry.path)].slice(0, MAX_RECENTS);
    await this.persistRecents();
    await this.rebuildMenu();
  }

  private async removeRecent(path: string): Promise<void> {
    const before = this.recents.length;
    this.recents = this.recents.filter((entry) => entry.path !== path);
    if (this.recents.length !== before) {
      await this.persistRecents();
      await this.rebuildMenu();
    }
  }

  private async openRecent(entry: RecentEntry): Promise<void> {
    try {
      // The path was re-granted at boot (Rust grants every recents entry); a moved/deleted file fails here and prunes.
      const text = await invoke<string>("read_allowed_file", { path: entry.path });
      await this.openExternal({ path: entry.path, name: entry.name, text });
    } catch {
      await message(`"${entry.name}" could not be opened — it may have been moved or deleted.`, { title: "Open Failed", kind: "error" });
      await this.removeRecent(entry.path);
    }
  }

  // --- menu ----------------------------------------------------------------------------------

  /**
   * Full topology now (File/Edit/View/Window/Help); non-File handlers are deliberately inert
   * placeholders for the desktop-UX phase — this module stays the ONLY writer of menu code.
   * Edit's Undo/Redo dispatch `runAction` rather than the OS-predefined items: the predefined pair
   * targets the WebView's (empty) DOM undo stack and would steal Cmd+Z from the canvas.
   */
  private async rebuildMenu(): Promise<void> {
    const run = (actionId: string) => () => void this.getHandle()?.runAction(actionId);
    // Tauri menu objects are Rust-side resources with NO GC finalizer — every one built here is
    // tracked so the previous generation can be closed after the new menu is installed.
    const created: Array<{ close(): Promise<void> }> = [];
    const track = <T extends { close(): Promise<void> }>(resource: T): T => {
      created.push(resource);
      return resource;
    };
    const item = async (options: Parameters<typeof MenuItem.new>[0]) => track(await MenuItem.new(options));
    const predefined = async (options: Parameters<typeof PredefinedMenuItem.new>[0]) => track(await PredefinedMenuItem.new(options));
    const submenu = async (options: Parameters<typeof Submenu.new>[0]) => track(await Submenu.new(options));

    const recentsItems = await Promise.all(this.recents.map((entry) => item({ text: entry.name, action: () => void this.openRecent(entry) })));
    const noRecents = this.recents.length === 0 ? [await item({ text: "No Recent Files", enabled: false })] : [];

    const fileMenu = await submenu({
      text: "File",
      items: [
        await item({ text: "New", accelerator: "CmdOrCtrl+N", action: run("new-scene") }),
        await item({ text: "Open…", accelerator: "CmdOrCtrl+O", action: run("open-scene") }),
        await submenu({ text: "Open Recent", items: [...recentsItems, ...noRecents] }),
        await predefined({ item: "Separator" }),
        await item({ text: "Save", accelerator: "CmdOrCtrl+S", action: () => void this.saveFlow(false) }),
        await item({ text: "Save As…", accelerator: "CmdOrCtrl+Shift+S", action: () => void this.saveFlow(true) }),
        await predefined({ item: "Separator" }),
        await item({ text: "Export PNG", action: run("export-png") }),
        await item({ text: "Export SVG", action: run("export-svg") }),
        await predefined({ item: "Separator" }),
        await predefined({ item: "CloseWindow" }),
      ],
    });

    const editMenu = await submenu({
      text: "Edit",
      items: [
        await item({ text: "Undo", accelerator: "CmdOrCtrl+Z", action: run("undo") }),
        await item({ text: "Redo", accelerator: "CmdOrCtrl+Shift+Z", action: run("redo") }),
        await predefined({ item: "Separator" }),
        await predefined({ item: "Cut" }),
        await predefined({ item: "Copy" }),
        await predefined({ item: "Paste" }),
        await predefined({ item: "SelectAll" }),
      ],
    });

    // Cmd-modified accelerators only: a bare/shifted-character accelerator (the in-app "Shift+1"
    // style) would fire while the user is TYPING in a text element — native menus can't see the
    // editor's is-editing state the in-app shortcut resolver suppresses on.
    const viewMenu = await submenu({
      text: "View",
      items: [
        await item({ text: "Zoom In", accelerator: "CmdOrCtrl+=", action: run("zoom-in") }),
        await item({ text: "Zoom Out", accelerator: "CmdOrCtrl+-", action: run("zoom-out") }),
        await item({ text: "Reset Zoom", accelerator: "CmdOrCtrl+0", action: run("zoom-reset") }),
        await item({ text: "Zoom to Fit", action: run("zoom-to-fit") }),
        await predefined({ item: "Separator" }),
        await item({ text: "Toggle Theme", action: run("toggle-theme") }),
        await predefined({ item: "Separator" }),
        await predefined({ item: "Fullscreen" }),
      ],
    });

    const windowMenu = await submenu({
      text: "Window",
      items: [await predefined({ item: "Minimize" }), await predefined({ item: "Maximize" })],
    });

    // External URL via same-window navigation on purpose: the shell's on_navigation policy
    // intercepts it into the confirm-then-system-browser flow (main.rs).
    const helpMenu = await submenu({
      text: "Help",
      items: [await item({ text: "Deviva Draw Help", action: () => window.location.assign("https://draw.deviva.app") })],
    });

    const items: Submenu[] = [fileMenu, editMenu, viewMenu, windowMenu, helpMenu];
    if (navigator.userAgent.includes("Mac")) {
      // macOS app menu: quitting goes through window.close() so the unsaved-close guard is the
      // single gate for EVERY exit path (the predefined Quit item would bypass it).
      items.unshift(
        await submenu({
          text: "Deviva Draw",
          items: [
            await item({ text: "About Deviva Draw", action: () => void this.showAbout() }),
            await predefined({ item: "Separator" }),
            await predefined({ item: "Hide" }),
            await predefined({ item: "HideOthers" }),
            await predefined({ item: "ShowAll" }),
            await predefined({ item: "Separator" }),
            await item({ text: "Quit Deviva Draw", accelerator: "CmdOrCtrl+Q", action: () => void getCurrentWindow().close() }),
          ],
        }),
      );
    }

    const menu = track(await Menu.new({ items }));
    await menu.setAsAppMenu();

    // Free the previous generation only after the new menu is live.
    const stale = this.menuResources;
    this.menuResources = created;
    for (const resource of stale) {
      try {
        await resource.close();
      } catch {
        // already closed / never registered — nothing to free
      }
    }
  }

  // --- helpers -------------------------------------------------------------------------------

  /** The handle appears asynchronously after mount; external opens may arrive first. */
  private async waitForHandle(timeoutMs = 10_000): Promise<DevivaDrawHandle | null> {
    const t0 = Date.now();
    for (;;) {
      const handle = this.getHandle();
      if (handle) return handle;
      if (Date.now() - t0 > timeoutMs) {
        console.error("deviva-desktop: editor handle never became ready");
        this.toast("The editor did not finish loading — the file could not be opened.");
        return null;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  private async showAbout(): Promise<void> {
    const version = await getVersion();
    await message(`Deviva Draw ${version}\n\nAn open-source infinite-canvas whiteboard.\nWeb version + docs: https://draw.deviva.app (Help menu opens it).`, { title: "About Deviva Draw" });
  }

  /**
   * Rust forwards dropped image FILES as bytes (Tauri's drag-drop interception means the DOM never
   * sees them) — re-dispatch through the canvas's own DOM drop pipeline so insert behavior,
   * positioning, and validation stay identical to the web app's.
   */
  private insertDroppedImage(payload: { name: string; mimeType: string; dataBase64: string; x: number; y: number }): void {
    try {
      const bytes = Uint8Array.from(atob(payload.dataBase64), (char) => char.charCodeAt(0));
      const file = new File([bytes], payload.name, { type: payload.mimeType });
      const transfer = new DataTransfer();
      transfer.items.add(file);
      const host = document.querySelector('[data-testid="deviva-draw-canvas-host"]');
      if (!host) return;
      const scale = window.devicePixelRatio || 1;
      host.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: payload.x / scale, clientY: payload.y / scale }));
    } catch (error) {
      console.error("deviva-desktop: dropped image could not be inserted", error);
    }
  }

  /** Minimal dismissible toast — shell-level UI, deliberately outside the React tree. */
  private toast(text: string): void {
    const node = document.createElement("div");
    node.textContent = text;
    node.setAttribute("role", "status");
    node.style.cssText =
      "position:fixed;bottom:16px;left:50%;transform:translateX(-50%);max-width:70%;padding:10px 16px;" +
      "background:#1f2937;color:#f9fafb;border-radius:8px;font:13px system-ui;z-index:99999;cursor:pointer;box-shadow:0 4px 12px rgba(0,0,0,.35)";
    node.addEventListener("click", () => node.remove());
    document.body.appendChild(node);
    setTimeout(() => node.remove(), 10_000);
  }
}
