/**
 * `ActionRegistry`'s core types: an `Action` is the one place a piece of app behavior is defined
 * (id, i18n label key, icon, optional shortcut display combo, `run`/`isEnabled`), and `ActionRuntime`
 * is the live, already-constructed engine wiring every action reads/writes through — the toolbar,
 * properties panel, context menu, main menu, command palette, and keyboard shortcuts all resolve
 * through the *same* registry against the *same* runtime, so there is exactly one implementation of
 * "what does duplicate/delete/group/zoom-in actually do" (this phase's DRY requirement).
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

/** Booleans backed by the app shell's own React state, exposed as get/set pairs so action handlers (living outside React) can read/toggle them without needing hooks. */
export interface UiToggleState {
  getZenMode(): boolean;
  setZenMode(value: boolean): void;
  getViewOnly(): boolean;
  setViewOnly(value: boolean): void;
  getStatsPanelVisible(): boolean;
  setStatsPanelVisible(value: boolean): void;
  getCommandPaletteOpen(): boolean;
  setCommandPaletteOpen(value: boolean): void;
  getShortcutsDialogOpen(): boolean;
  setShortcutsDialogOpen(value: boolean): void;
}

/** Async browser-facing persistence/export operations — injected so the pure action definitions never import DOM-only code directly (see `browser/persistence-adapters.ts`). */
export interface PersistenceOperations {
  newScene(): void;
  openScene(): Promise<void>;
  saveScene(): Promise<void>;
  exportPng(): Promise<void>;
  exportSvg(): Promise<void>;
  copyAsImage(): Promise<void>;
}

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
