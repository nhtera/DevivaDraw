/**
 * Composes `build-tools.ts`'s engine wiring with the `ActionRegistry`/`ShortcutRegistry`/
 * `PointerEventPipeline` chrome layer into one `DevivaRuntime` — the single object
 * `use-deviva-runtime.ts`'s effect builds once per mounted canvas (rebuilt whenever the live `Scene`
 * instance itself is swapped, e.g. after "Open").
 */
import {
  createElementTarget,
  createGlobalTarget,
  PointerEventPipeline,
  registerFullShortcutMap,
  ShortcutRegistry,
} from "@deviva-draw/engine";
import type { Camera, Scene } from "@deviva-draw/engine";
import { buildActionRegistry } from "../actions/build-action-registry";
import type { PersistenceOperations, UiToggleState } from "../actions/action-types";
import type { ThemeMode } from "../theme/theme-tokens";
import { buildTools } from "./build-tools";
import type { BuiltTools } from "./build-tools";
import { attachDoubleClickToEditListener } from "./double-click-edit";
import { shouldSuppressGlobalShortcuts } from "./should-suppress-global-shortcuts";
import { PAN_TOOL_NAME, SELECT_TOOL_NAME, TEXT_TOOL_NAME } from "./tool-names";
import type { DevivaRuntime } from "./runtime-types";

export interface BuildRuntimeOptions {
  container: HTMLElement;
  scene: Scene;
  getCamera(): Camera;
  setCamera(camera: Camera): void;
  ui: UiToggleState;
  /**
   * Deferred rather than a ready-made `PersistenceOperations` object: `buildPersistenceOperations`
   * (the real implementation, in `build-persistence-operations.ts`) needs the `history`/`selection`
   * this function's own `buildTools` call is about to produce, so the caller supplies a factory
   * instead of having to build tools twice (once to get `history`/`selection`, once for real) just to
   * sequence the dependency correctly.
   */
  createPersistence(deps: { history: BuiltTools["historyStack"]; selection: BuiltTools["selectionState"] }): PersistenceOperations;
  /** Same config `createPersistence`'s "Share" implementation depends on — gates whether the "Share" action is registered at all (see `buildActionRegistry`'s `shareEnabled` doc) rather than registering an action that would just reject every time it ran. */
  shareApiBaseUrl?: string;
  getThemeMode(): ThemeMode;
  toggleThemeMode(): void;
  /** `true` while the tool lock is engaged — a creation tool then stays active after drawing (repeated-draw workflow) instead of handing back to the select tool. See `build-tools.ts`'s `handleCreated`. */
  getToolLocked(): boolean;
  /**
   * `true` while the command palette, shortcuts dialog, main menu, or context menu is open —
   * combined (via `should-suppress-global-shortcuts.ts`) with the existing text-editing check to
   * build the pipeline's `isEditingTextSuppressed` callback, so a bare letter key typed into an open
   * overlay's search input (or just pressed while a menu is open) can never leak through and switch
   * tools behind it. Escape still closes the overlay via that overlay's own `onKeyDown`/outside-click
   * handler — suppression only silences the *global* resolver, not the overlay's own DOM listeners.
   */
  isChromeOverlayOpen(): boolean;
}

/** Builds every action handler `PointerEventPipeline` resolves a shortcut to — a single dispatch through `ActionRegistry.run`, keyed by the exact same action id string the engine's `ShortcutRegistry` resolves keydowns to (see `actions/*.ts`'s `id` fields, chosen to match `registerFullShortcutMap`'s action-name vocabulary). */
function buildPipelineActionHandlers(runtime: DevivaRuntime): Record<string, () => void> {
  const handlers: Record<string, () => void> = {};
  for (const action of runtime.actionRegistry.list()) {
    handlers[action.id] = () => {
      const result = runtime.actionRegistry.run(action.id, runtime);
      if (result instanceof Promise) result.catch((error: unknown) => console.error(`deviva-draw: action "${action.id}" failed`, error));
    };
  }
  return handlers;
}

export function buildRuntime(options: BuildRuntimeOptions): DevivaRuntime {
  const { container, scene, getCamera, setCamera, ui, createPersistence, shareApiBaseUrl, getThemeMode, toggleThemeMode, getToolLocked, isChromeOverlayOpen } = options;
  const tools = buildTools(container, scene, getCamera, setCamera, getThemeMode, getToolLocked);
  const persistence = createPersistence({ history: tools.historyStack, selection: tools.selectionState });
  const actionRegistry = buildActionRegistry({ shareEnabled: Boolean(shareApiBaseUrl) });

  const runtime: DevivaRuntime = {
    scene,
    selection: tools.selectionState,
    history: tools.historyStack,
    clipboard: tools.clipboard,
    styleState: tools.styleState,
    toolStateMachine: tools.toolStateMachine,
    panZoomTool: tools.panZoomTool,
    editSession: tools.editSession,
    getCamera,
    getViewportSize: () => ({ width: container.clientWidth, height: container.clientHeight }),
    grid: tools.grid,
    objectSnap: tools.objectSnap,
    ui,
    theme: { get mode() { return getThemeMode(); }, toggleMode: toggleThemeMode },
    persistence,
    actionRegistry,
    // `PointerEventPipeline` is assigned right below — TypeScript needs a placeholder to satisfy the
    // interface within this single object literal; overwritten before this function returns.
    pipeline: undefined as unknown as PointerEventPipeline,
    getMarqueeRect: () => tools.selectionTool.getMarqueeRect(),
    getSnapGuides: () => tools.selectionTool.getSnapGuides(),
    getPendingEraseIds: () => tools.eraserTool.getPendingEraseIds(),
    getLaserTrail: () => tools.laserTool.getTrail(),
    getLassoPath: () => tools.lassoTool.getPath(),
    // Either tool can be offering a bind target: the arrow tool while drawing, the select tool while
    // dragging an existing endpoint. Only one is ever active, so concatenating needs no arbitration.
    getBindingHighlightIds: () => [...tools.arrowTool.getBindingHighlightIds(), ...tools.selectionTool.getBindingHighlightIds()],
    getBindingAnchor: () => tools.arrowTool.getBindingAnchor() ?? tools.selectionTool.getBindingAnchor(),
    getHoverPoint: () => tools.selectionTool.getHoverPoint(),
    // Space-held is checked first so the grab preview shows the moment the key goes down, before any
    // drag re-routes through the pan tool. Every creation tool gets the crosshair — precise placement
    // is the shared affordance — and the select tool computes its own move/resize/rotate feedback.
    getCursor: () => {
      const machine = tools.toolStateMachine;
      const active = machine.getActiveToolName();
      if (active !== PAN_TOOL_NAME && runtime.pipeline?.isSpacePanPrimed()) return "grab";
      if (active === PAN_TOOL_NAME) return machine.isGestureInProgress() ? "grabbing" : "grab";
      if (active === SELECT_TOOL_NAME) return tools.selectionTool.getCursor();
      if (active === TEXT_TOOL_NAME) return "text";
      return "crosshair";
    },
    dispose: () => {
      /* replaced below */
    },
  };

  const shortcutRegistry = new ShortcutRegistry();
  registerFullShortcutMap(shortcutRegistry);

  const pipeline = new PointerEventPipeline({
    element: createElementTarget(container),
    globalTarget: createGlobalTarget(window),
    toolStateMachine: tools.toolStateMachine,
    panZoomTool: tools.panZoomTool,
    shortcutRegistry,
    getCamera,
    historyStack: tools.historyStack,
    actionHandlers: buildPipelineActionHandlers(runtime),
    isEditingTextSuppressed: () => shouldSuppressGlobalShortcuts(tools.editSession.getState().status === "editing", isChromeOverlayOpen()),
  });
  pipeline.attach();
  runtime.pipeline = pipeline;

  const detachDoubleClick = attachDoubleClickToEditListener({
    container,
    scene,
    toolStateMachine: tools.toolStateMachine,
    selectToolName: SELECT_TOOL_NAME,
    editSession: tools.editSession,
    textMeasurer: tools.textMeasurer,
    getCamera,
    styleState: tools.styleState,
    selection: tools.selectionState,
  });

  runtime.dispose = () => {
    detachDoubleClick();
    tools.disposeHooks();
    pipeline.detach();
  };

  return runtime;
}
