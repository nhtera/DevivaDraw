/**
 * Routes pointer-gesture and keyboard events to whichever `ToolHandler` is currently "active",
 * and owns the single tool-switch rule this codebase needs: switching mid-gesture is rejected, not
 * queued. Queueing was considered and rejected — it would switch tools on the *next* click instead
 * of the one the user actually made, which is more surprising than an explicit no-op, and no
 * concrete tool needs a deferred switch. `isGestureInProgress()` lets a caller (e.g. a toolbar) know
 * why a `setTool` call failed. `subscribe()` (same plain `Set`-of-callbacks pub-sub `scene/scene.ts`
 * and `selection/selection-state.ts` already use) lets a toolbar highlight the active tool reactively
 * instead of polling `getActiveToolName()` on a timer.
 */
import type { Point } from "../render/camera";
import type { ModifierKeys, ToolHandler } from "./tool-handler";

export type ToolChangeListener = () => void;

export class ToolStateMachine {
  private readonly tools = new Map<string, ToolHandler>();
  private activeToolName: string;
  private gestureInProgress = false;
  private readonly listeners = new Set<ToolChangeListener>();

  constructor(tools: Record<string, ToolHandler>, initialTool: string) {
    for (const [name, handler] of Object.entries(tools)) this.tools.set(name, handler);
    this.getTool(initialTool); // throws on an unknown initial tool before any state is set
    this.activeToolName = initialTool;
  }

  /** Adds or replaces the handler registered under `name`. Safe to call for the active tool. */
  registerTool(name: string, handler: ToolHandler): void {
    this.tools.set(name, handler);
  }

  getActiveToolName(): string {
    return this.activeToolName;
  }

  getActiveTool(): ToolHandler {
    return this.getTool(this.activeToolName);
  }

  isGestureInProgress(): boolean {
    return this.gestureInProgress;
  }

  /**
   * Switches the active tool. Returns `false` (no state change) while a gesture is in progress —
   * see the module doc for why that's rejected rather than queued. Throws if `name` was never
   * registered, since that is always a caller bug (a typo'd tool name, a shortcut wired to a tool
   * that was never registered), not a runtime condition to degrade gracefully from.
   */
  setTool(name: string): boolean {
    if (this.gestureInProgress) return false;
    this.getTool(name);
    if (name === this.activeToolName) return true; // no-op re-selection: not a change, no notify
    this.activeToolName = name;
    for (const listener of this.listeners) listener();
    return true;
  }

  /** Registers a listener fired whenever `setTool` actually changes the active tool; returns an unsubscribe function. */
  subscribe(listener: ToolChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** `pressure`/`pointerType` are forwarded verbatim to the active tool — see `ToolHandler.onGestureStart`'s doc. */
  dispatchGestureStart(point: Point, modifiers: ModifierKeys, pressure?: number, pointerType?: string): void {
    this.gestureInProgress = true;
    this.getActiveTool().onGestureStart(point, modifiers, pressure, pointerType);
  }

  dispatchGestureMove(point: Point, modifiers: ModifierKeys, pressure?: number, pointerType?: string): void {
    if (!this.gestureInProgress) return;
    this.getActiveTool().onGestureMove(point, modifiers, pressure, pointerType);
  }

  dispatchGestureEnd(point: Point, modifiers: ModifierKeys, pressure?: number, pointerType?: string): void {
    if (!this.gestureInProgress) return;
    this.gestureInProgress = false;
    this.getActiveTool().onGestureEnd(point, modifiers, pressure, pointerType);
  }

  /** See `ToolHandler.onGestureCancel` — the abort path for Escape/`pointercancel`/blur. */
  dispatchGestureCancel(modifiers: ModifierKeys): void {
    if (!this.gestureInProgress) return;
    this.gestureInProgress = false;
    this.getActiveTool().onGestureCancel(modifiers);
  }

  /** Forwarded unconditionally, including mid-gesture (a live modifier-key toggle while dragging). */
  dispatchKeyDown(key: string, modifiers: ModifierKeys): void {
    this.getActiveTool().onKeyDown(key, modifiers);
  }

  private getTool(name: string): ToolHandler {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`tool-state-machine: no tool registered as "${name}"`);
    return tool;
  }
}
