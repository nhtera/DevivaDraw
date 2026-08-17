/**
 * `ActionRegistry`'s core types: an `Action` is the one place a piece of app behavior is defined
 * (id, i18n label key, icon, optional shortcut display combo, `run`/`isEnabled`), and `ActionRuntime`
 * is the live, already-constructed engine wiring every action reads/writes through — the toolbar,
 * properties panel, context menu, main menu, command palette, and keyboard shortcuts all resolve
 * through the *same* registry against the *same* runtime, so there is exactly one implementation of
 * "what does duplicate/delete/group/zoom-in actually do" (single source of truth for every chrome surface).
 */
import type {
  AnyElement,
  Camera,
  HistoryStack,
  InternalClipboard,
  PanZoomTool,
  Scene,
  SelectionState,
  ShapeStyleState,
  TextEditSession,
  ToolStateMachine,
} from "@deviva-draw/engine";
import type { TranslationKey } from "../i18n/catalog-en";
import type { ThemeMode } from "../theme/theme-tokens";

/** A surfaced save result — see `PersistenceOperations.saveSceneOutcome`. */
export type SaveDocumentOutcome = "saved" | "canceled" | { error: string };

/** Live mutable grid-mode state — a plain object, not React state, so the render loop and the select tool's snap-to-grid both read the exact same live value every frame. */
export interface GridState {
  enabled: boolean;
  size: number;
}

/** Live mutable "snap to objects" state — same in-place-mutation contract as `GridState`: the move gesture reads it on every pointer move, so it must not be a captured boolean. */
export interface ObjectSnapState {
  enabled: boolean;
}

/** Booleans backed by the app shell's own React state, exposed as get/set pairs so action handlers (living outside React) can read/toggle them without needing hooks. */
export interface UiToggleState {
  getZenMode(): boolean;
  setZenMode(value: boolean): void;
  getViewOnly(): boolean;
  setViewOnly(value: boolean): void;
  getStatsPanelVisible(): boolean;
  setStatsPanelVisible(value: boolean): void;
  getLayersPanelVisible(): boolean;
  setLayersPanelVisible(value: boolean): void;
  getMinimapVisible(): boolean;
  setMinimapVisible(value: boolean): void;
  /** The shape/canvas properties panel (and its phone-tier `MobilePropertiesBar` equivalent) — separately hideable so a user can reclaim the side of the canvas without entering zen mode. */
  getPropertiesPanelVisible(): boolean;
  setPropertiesPanelVisible(value: boolean): void;
  /** The toolbar's "keep the active tool after drawing" lock — the same boolean `build-runtime.ts`'s `getToolLocked` reads, exposed here so the action registry (menu row, palette, `Q`) can flip it too. */
  getToolLocked(): boolean;
  setToolLocked(value: boolean): void;
  /** Presentation mode — frames walked as slides. See `components/presentation/presentation-controller.tsx`. */
  getPresentationActive(): boolean;
  setPresentationActive(value: boolean): void;
  getCommandPaletteOpen(): boolean;
  setCommandPaletteOpen(value: boolean): void;
  getShortcutsDialogOpen(): boolean;
  setShortcutsDialogOpen(value: boolean): void;
  getShareDialogState(): ShareDialogState;
  setShareDialogState(state: ShareDialogState): void;
}

/**
 * Async browser-facing persistence/export operations — injected so the pure action definitions never
 * import DOM-only code directly (see `browser/persistence-adapters.ts`).
 *
 * Scope of that rule: it exists because these operations are *async, failable, and host-specific* —
 * a file picker, a download, a network upload — so a host must be able to substitute its own
 * (the desktop shell does exactly that). It has never covered synchronous, self-guarding preference
 * storage: `toggle-grid`/`toggle-object-snap` already reach `window.localStorage` inline in
 * `view-actions.ts`, and the three editor-behavior preferences there import
 * `browser/editor-preferences.ts` for the same reason. That store is deliberately a module-level
 * singleton — the engine reads it live through getters threaded into tool deps — so injecting it
 * per-action would create a second source of truth for a value the engine is already reading
 * directly. Every one of those paths no-ops without a `window`, so nothing here is DOM-*dependent*.
 */
export interface PersistenceOperations {
  newScene(): void;
  openScene(): Promise<void>;
  /**
   * Swaps the live document for an already-parsed `Scene` — the same replacement "Open" performs once
   * its picker has resolved, exposed on its own for callers that were handed the file directly (a
   * document dropped on the canvas, see `hooks/use-document-file-drop.ts`).
   */
  loadScene(scene: Scene): void;
  saveScene(): Promise<void>;
  /**
   * `saveScene` with the outcome surfaced instead of swallowed — the desktop shell's Save flow needs
   * to distinguish saved / canceled / failed to drive its error dialog + Save-As fallback and its
   * quit-guard "Save then close". `saveAs: true` forces the Save-As dialog even when the document
   * already has a path. Optional: only provider-backed builds supply it (browser hosts keep the
   * fire-and-forget `saveScene`).
   */
  saveSceneOutcome?(options?: { saveAs?: boolean }): Promise<SaveDocumentOutcome>;
  /**
   * Resolves once the scene holds every byte it is supposed to — image payloads kept outside the
   * document have to be read back after boot (see `runtime/restore-document-files.ts`). The
   * operations below already wait on it; anything ELSE that turns the scene into pixels or bytes
   * (the export dialog) must await it first, or it can render a blank box where an image belongs.
   * Always present, resolved immediately when there is nothing to wait for.
   */
  whenFilesReady(): Promise<void>;
  /**
   * Reads back any image payload the live scene is missing. For elements that arrived from outside
   * the document — a library item carries `fileId`s but no bytes, and after a reload the scene has
   * no reason to be holding them. Resolves when the canvas has been told to repaint.
   */
  restoreMissingFiles(): Promise<void>;
  exportPng(): Promise<void>;
  exportSvg(): Promise<void>;
  copyAsImage(): Promise<void>;
  /** SVG markup to the clipboard as text — see `browser/scene-file-operations.ts`'s `copySceneSvgToClipboard`. */
  copyAsSvg(): Promise<void>;
  /**
   * Encrypts the live scene client-side and uploads only ciphertext to the collab-server, resolving
   * the shareable URL (or rejecting on failure) — see `browser/share-link-client.ts` and
   * `@deviva-draw/engine`'s `share-link/` module for the actual crypto. Unlike every other operation
   * here, this one surfaces its result (the URL, or an error) to the caller instead of swallowing
   * failures via a logged `console.error`: `actions/share-actions.ts` needs the URL to populate
   * `ShareDialogState`, and a silent failure would leave the share dialog stuck on "generating"
   * forever with no explanation.
   */
  shareScene(options?: ShareSceneOptions): Promise<ShareLinkResult>;
}

export interface ShareSceneOptions {
  /** ISO-8601 instant the link should stop working — omitted for a never-expiring link (the default). The server validates and enforces; the client only chooses. */
  expiresAt?: string;
}

/**
 * What creating a share link yields beyond the URL: the blob id plus the revocation-capability
 * token, which exist ONLY on the creating client (the server stores just the token's hash) — the
 * dialog persists them to local history so this browser can revoke the link later. The full URL
 * (whose fragment carries the decryption key) is deliberately NOT part of what history stores.
 */
export interface ShareLinkResult {
  url: string;
  blobId: string;
  deleteToken: string;
  pageCount: number;
  /** Echo of the expiry the link was created with, when one was chosen — rides into history for display. */
  expiresAt?: string;
}

/**
 * Drives the main-menu-triggered share-link dialog (`components/share-dialog.tsx`) — the same
 * "action handler writes state, a chrome component renders it" shape `UiToggleState`'s other get/set
 * pairs already use for zen mode / view-only / stats, just non-boolean since a share link has more
 * than two states worth distinguishing in the UI (in flight vs. succeeded-with-a-URL vs. failed). The
 * "error" branch carries no message: `share-dialog.tsx` only ever shows a fixed i18n'd string for it
 * (there's no per-error-cause copy to select between), and the actual failure detail is already
 * `console.error`-logged by `actions/share-actions.ts` for debugging — carrying it here too would just
 * be a second, unread copy of the same information.
 */
/**
 * "idle" is the dialog freshly opened, no link minted yet: creating a link is an explicit click,
 * never a side effect of opening — every generated link is a live, fetchable copy of the board, so
 * a user opening the dialog just to REVOKE one must not silently create another.
 */
export type ShareDialogState = { status: "closed" } | { status: "idle" } | { status: "generating" } | { status: "ready"; url: string } | { status: "error" };

/** Every live object an `Action.run`/`isEnabled` may need. Built once per mounted `<DevivaDraw/>` by `runtime/build-runtime.ts`. */
export interface ActionRuntime {
  scene: Scene;
  selection: SelectionState;
  history: HistoryStack<AnyElement[]>;
  clipboard: InternalClipboard;
  styleState: ShapeStyleState;
  toolStateMachine: ToolStateMachine;
  panZoomTool: PanZoomTool;
  editSession: TextEditSession;
  getCamera(): Camera;
  getViewportSize(): { width: number; height: number };
  grid: GridState;
  objectSnap: ObjectSnapState;
  ui: UiToggleState;
  theme: { mode: ThemeMode; toggleMode(): void };
  persistence: PersistenceOperations;
}

export interface Action {
  id: string;
  labelKey: TranslationKey;
  /** Icon name resolved by `components/icon.tsx` — kept a string id (not a component) so an `Action` stays plain data. */
  icon: string;
  /** Normalized combo string (e.g. `"meta+z"`) shown in tooltips/the shortcuts dialog — `undefined` for actions with no keyboard binding (most context-menu-only actions). */
  shortcut?: string;
  run(runtime: ActionRuntime): void | Promise<void>;
  /** Defaults to always-enabled when omitted. */
  isEnabled?(runtime: ActionRuntime): boolean;
  /**
   * Whether this action stays available while the shell is in view-only mode (the shared-scene
   * viewer, or the main-menu toggle). Defaults to `false` — view-only is a promise ("can view, not
   * edit"), so an action must opt IN by being provably scene-preserving: navigation, view
   * preferences, exports/copies, sharing, and the view-only toggle itself. Every action that
   * mutates the scene, the page list, or the active tool stays blocked by the registry.
   */
  viewOnlyAllowed?: boolean;
}
