/**
 * State machine for one text-editing session — standalone placement (`tools/text-tool.ts`) and
 * bound-text double-click editing (`bound-text.ts`) both drive the exact same commit/cancel/
 * discard-if-empty logic through this class, so that behavior only needs to be right once.
 *
 * Deliberately DOM-free: the React-layer overlay (`packages/react`) is the only thing that ever
 * mounts a `<textarea>`; this class just owns the draft string plus the undo-batch bookkeeping,
 * mirroring `tools/drag-shape-tool-base.ts`'s beginBatch/endBatch/cancelBatch shape for a gesture
 * that isn't a pointer drag. Kept IME-safe by construction: `updateDraft` only ever updates local
 * state, never touches `Scene` — a keystroke mid-IME-composition (e.g. Vietnamese diacritics, a CJK
 * input method) can never partially-commit into the shared document; only `commit()` writes.
 */
import type { TextElement } from "../elements/text-element";
import type { Scene } from "../scene/scene";
import type { ShapeToolHistory } from "../tools/drag-shape-tool-base";

export interface TextEditSessionDeps {
  scene: Scene;
  history: ShapeToolHistory;
}

export interface TextEditSessionStartOptions {
  elementId: string;
  initialText: string;
  /**
   * A just-created, still-empty element. `commit()` deletes an emptied-out draft regardless of this
   * flag (see its doc) — `isNewElement` only changes `cancel()`'s behavior: abandoning (not
   * committing) a brand-new draft deletes it outright, matching `DragShapeTool`'s zero-size-discard
   * rule for an accidental click; abandoning an edit to pre-existing content leaves that content
   * untouched, since `updateDraft` never wrote anything to `Scene` in the first place.
   */
  isNewElement: boolean;
  /** Runs once after a successful `commit()` (after the `Scene` write). Lets `bound-text.ts` re-run the container auto-grow/wrap without this class needing to know bound text exists at all. */
  onCommitted?: (elementId: string, finalText: string) => void;
}

export type TextEditSessionState =
  | { status: "idle" }
  | { status: "editing"; elementId: string; draftText: string; isNewElement: boolean };

const IDLE_STATE: TextEditSessionState = { status: "idle" };

export class TextEditSession {
  private readonly deps: TextEditSessionDeps;
  private state: TextEditSessionState = IDLE_STATE;
  private onCommitted: TextEditSessionStartOptions["onCommitted"];
  private readonly listeners = new Set<() => void>();

  constructor(deps: TextEditSessionDeps) {
    this.deps = deps;
  }

  getState(): TextEditSessionState {
    return this.state;
  }

  /** Registers a change listener (fired on every `start`/`updateDraft`/`commit`/`cancel`); returns an unsubscribe function — same shape as `Scene.subscribe`. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Opens a session for `elementId`. Starting again for the *same* `elementId` that's already open
   * is a no-op (returns the current in-progress state untouched) — a caller re-invoking the same
   * double-click-to-edit / click-to-place entry point while a session is already live (e.g. a
   * double-click firing its own two single-click gestures first) must never cancel a draft the user
   * is actively typing into: `cancel()` would soft-delete a still-open new-element draft, and this
   * `start()` would then reopen editing on that now-deleted element — the user keeps typing, hits
   * commit, and the text lands on an `isDeleted` element while the container silently loses its
   * label. Starting for a *different* `elementId` still cancels the abandoned session first (see
   * the caller-bug reasoning below) since that genuinely is a different element being edited.
   */
  start(options: TextEditSessionStartOptions): void {
    if (this.state.status === "editing" && this.state.elementId === options.elementId) {
      return;
    }

    if (this.state.status === "editing") {
      // Starting a *different* element while one is already open is a caller bug (the overlay only
      // ever mounts one `<textarea>` at a time) — reported via `console.warn` and recovered by
      // cancelling the abandoned session first, rather than silently leaking its open undo batch or
      // losing track of which element the caller thinks is being edited.
      console.warn(`text-edit-session: starting "${options.elementId}" while "${this.state.elementId}" is still open; cancelling it first`);
      this.cancel();
    }

    this.onCommitted = options.onCommitted;
    this.deps.history.beginBatch();
    this.setState({ status: "editing", elementId: options.elementId, draftText: options.initialText, isNewElement: options.isNewElement });
  }

  /** Local-only update — never touches `Scene` (see module doc on IME safety). No-op if no session is open. */
  updateDraft(text: string): void {
    if (this.state.status !== "editing") return;
    this.setState({ ...this.state, draftText: text });
  }

  /**
   * Writes the draft into `Scene` and closes the session — or, if the draft is empty (whitespace
   * only counts as empty), deletes the element instead of writing an empty string. This applies
   * regardless of `isNewElement`: a still-untouched new draft has nothing to keep, and existing
   * content deliberately edited all the way down to nothing has just as little reason to survive as
   * a blank, invisible, still-selectable "zombie" element (or, for bound text, a blank label a
   * container keeps pointing at). Either way this still ends the batch as one undoable step — the
   * user can always undo back to whatever was there before (nothing, for a fresh element; the prior
   * text, for an edited one) — never `cancelBatch()`, since a real `Scene` mutation happened either
   * way (either a delete or a text write) and both must be undoable.
   */
  commit(): void {
    if (this.state.status !== "editing") return;
    const { elementId, draftText } = this.state;

    if (draftText.trim() === "") {
      this.deps.scene.deleteElement(elementId);
    } else {
      // `Scene.updateElement`'s `ElementUpdate` type only includes fields common to every
      // `AnyElement` member — `text` is `TextElement`-only, so a pre-typed `Partial<TextElement>`
      // local is needed to pass it through; `Scene` itself just spreads `changes`, so this is a
      // type-level-only gap, not a runtime one (see `tools/freedraw-tool.ts`'s identical pattern).
      const changes: Partial<TextElement> = { text: draftText };
      this.deps.scene.updateElement(elementId, changes);
    }
    this.deps.history.endBatch(this.deps.scene.getElements());

    const callback = this.onCommitted;
    this.finish();
    callback?.(elementId, draftText);
  }

  /** Discards the draft without writing it. A new element is deleted outright (see `isNewElement`'s doc); an existing element was never mutated by `updateDraft`, so there is nothing to revert. */
  cancel(): void {
    if (this.state.status !== "editing") return;
    const { elementId, isNewElement } = this.state;

    if (isNewElement) this.deps.scene.deleteElement(elementId);
    this.deps.history.cancelBatch();
    this.finish();
  }

  private finish(): void {
    this.onCommitted = undefined;
    this.setState(IDLE_STATE);
  }

  private setState(next: TextEditSessionState): void {
    this.state = next;
    for (const listener of this.listeners) listener();
  }
}
