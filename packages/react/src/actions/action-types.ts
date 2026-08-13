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
  getMinimapVisible(): boolean;
  setMinimapVisible(value: boolean): void;
  getCommandPaletteOpen(): boolean;
  setCommandPaletteOpen(value: boolean): void;
  getShortcutsDialogOpen(): boolean;
  setShortcutsDialogOpen(value: boolean): void;
  getShareDialogState(): ShareDialogState;
  setShareDialogState(state: ShareDialogState): void;
}

/** Async browser-facing persistence/export operations — injected so the pure action definitions never import DOM-only code directly (see `browser/persistence-adapters.ts`). */
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
  exportPng(): Promise<void>;
  exportSvg(): Promise<void>;
  copyAsImage(): Promise<void>;
  /**
   * Encrypts the live scene client-side and uploads only ciphertext to the collab-server, resolving
   * the shareable URL (or rejecting on failure) — see `browser/share-link-client.ts` and
   * `@deviva-draw/engine`'s `share-link/` module for the actual crypto. Unlike every other operation
   * here, this one surfaces its result (the URL, or an error) to the caller instead of swallowing
   * failures via a logged `console.error`: `actions/share-actions.ts` needs the URL to populate
   * `ShareDialogState`, and a silent failure would leave the share dialog stuck on "generating"
   * forever with no explanation.
   */
  shareScene(): Promise<string>;
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
export type ShareDialogState = { status: "closed" } | { status: "generating" } | { status: "ready"; url: string } | { status: "error" };

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
}
