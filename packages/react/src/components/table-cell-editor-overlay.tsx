/**
 * Table cell editor: double-clicking a cell (or placing a new table) opens ONE persistent textarea
 * positioned over exactly that cell. Tab/Shift+Tab commit and move row-major WITHOUT unmounting the
 * textarea (only its value/position/tracked cell change — remounting loses focus mid-chain); Tab past
 * the last cell appends a row in the SAME history batch as that commit, so one Tab is one undo step.
 * Enter is a plain newline; Escape/blur commit and close (Escape stops propagation — the same
 * keystroke must never leak on to the select tool after the session closes, the editor-close lesson).
 * Closing sets a ref-guard BEFORE the state update: unmounting a focused textarea fires a native
 * blur whose stale-closure handler would otherwise run a second, duplicate commit batch (the
 * `TextEditSession.commit()` already-closed-guard precedent).
 *
 * The window-event handoff mirrors `image-crop-overlay.tsx` (`deviva:table-cell-edit`), NOT
 * `TextEditSession` — that machine is single-element-per-session and drives the canvas text draft;
 * here the textarea paints an opaque chrome background over the cell (the spreadsheet "lifted cell"
 * look), so the canvas underneath never double-renders the glyphs. Rotated tables don't offer cell
 * editing: the finder resolves them fine, but `sessionTable`'s `angle !== 0` guard keeps this
 * overlay inert for them (axis-aligned placement math; same v1 stance as the crop editor).
 *
 * Commit/Tab logic is pure and lives in `table-cell-edit-commit.ts` (unit-tested there); this
 * component owns only the session state, positioning, and the history-batch lifecycle.
 */
import { MAX_TABLE_CELL_CHARS, createCanvasTextMeasurer, panCameraByScreenDelta, sceneToScreen, TABLE_CELL_PADDING, tableCellRect, tableCellText, TEXT_FONT_FAMILY_CSS, DEFAULT_TEXT_LINE_HEIGHT } from "@deviva-draw/engine";
import type { TableElement } from "@deviva-draw/engine";
import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { buildCellCommit, buildCommitRefit, tabDestination } from "./table-cell-edit-commit";
import { computeKeyboardPanDelta } from "../browser/visual-viewport-inset";
import { useCameraVersion, useSceneVersion } from "../runtime/use-live-version";
import type { CameraStore } from "../runtime/camera-store";
import type { DevivaRuntime } from "../runtime/runtime-types";

interface CellSession {
  elementId: string;
  row: number;
  col: number;
}

/** The live table for a session, or `null` once it stopped being editable (deleted remotely, restructured under the caret, turned locked/hidden, rotated). */
function sessionTable(runtime: DevivaRuntime, session: CellSession): TableElement | null {
  const element = runtime.scene.getElement(session.elementId);
  if (!element || element.type !== "table" || element.isDeleted || element.angle !== 0) return null;
  if (runtime.scene.isElementHidden(element) || runtime.scene.effectiveLocked(element)) return null;
  if (!tableCellRect(element, session.row, session.col)) return null;
  return element;
}

export function TableCellEditorOverlay(props: { runtime: DevivaRuntime; cameraStore: CameraStore; keyboardInsetPx?: number }) {
  const { runtime, cameraStore, keyboardInsetPx = 0 } = props;
  const [session, setSession] = useState<CellSession | null>(null);
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  /** True once this session is over — commit() refuses to run again, so the unmount-triggered blur after an Escape can never produce a duplicate batch. */
  const closedRef = useRef(false);
  useSceneVersion(runtime.scene);
  useCameraVersion(cameraStore);
  const measurer = useMemo(() => createCanvasTextMeasurer(document.createElement("canvas").getContext("2d")!), []);

  useEffect(() => {
    const onOpen = (event: Event) => {
      const { id, row, col } = (event as CustomEvent<{ id: string; row: number; col: number }>).detail;
      const candidate = sessionTable(runtime, { elementId: id, row, col });
      if (!candidate) return;
      closedRef.current = false;
      setSession({ elementId: id, row, col });
      setValue(tableCellText(candidate, row, col));
    };
    window.addEventListener("deviva:table-cell-edit", onOpen);
    return () => window.removeEventListener("deviva:table-cell-edit", onOpen);
  }, [runtime]);

  // Focus follows the session AND the tracked cell — the same textarea is reused across Tab moves.
  useEffect(() => {
    if (session) textareaRef.current?.focus();
  }, [session?.elementId, session?.row, session?.col]);

  // Keyboard avoidance, same contract as `use-text-editing.ts`'s: pan the CAMERA (cell + textarea
  // move together) once per tracked-cell / keyboard change, never per camera move, so it can't fight
  // a user pan. Geometry read fresh inside the effect.
  useEffect(() => {
    if (!session || keyboardInsetPx <= 0) return;
    const edited = sessionTable(runtime, session);
    const rect = edited ? tableCellRect(edited, session.row, session.col) : null;
    if (!edited || !rect) return;
    const camera = cameraStore.getCamera();
    const bottomPx = sceneToScreen({ x: edited.x + rect.x, y: edited.y + rect.y + rect.height }, camera).y;
    const delta = computeKeyboardPanDelta(bottomPx, runtime.getViewportSize().height, keyboardInsetPx);
    if (delta > 0) cameraStore.setCamera(panCameraByScreenDelta(camera, 0, delta));
    // Deps are deliberately only (cell, inset): runtime/cameraStore are stable wiring.
  }, [session?.elementId, session?.row, session?.col, keyboardInsetPx]);

  // The element vanished or stopped being editable mid-session (deleted remotely, undo removed it,
  // page switched, restructured under the caret): close, discarding the draft — there is nothing
  // consistent left to commit into. An effect, not a render-time setState.
  const liveTable = session ? sessionTable(runtime, session) : null;
  useEffect(() => {
    if (session && !liveTable) {
      closedRef.current = true;
      setSession(null);
    }
  }, [session, liveTable]);

  if (!session || !liveTable) return null;
  const table = liveTable;

  const close = (): void => {
    closedRef.current = true;
    setSession(null);
  };

  /** Commits the draft (and optionally the row append) as ONE batch — a no-op when closed or unchanged. */
  const commit = (appendRow: boolean): void => {
    if (closedRef.current) return;
    const plan = buildCellCommit(table, session.row, session.col, value, appendRow);
    if (!plan) return;
    runtime.history.beginBatch();
    runtime.scene.updateElement(table.id, plan.changes);
    const updated = runtime.scene.getElement(table.id);
    if (updated && updated.type === "table") {
      const refit = buildCommitRefit(updated, measurer);
      if (refit) runtime.scene.updateElement(table.id, refit);
    }
    runtime.history.endBatch(runtime.scene.getElements());
  };

  const moveTo = (row: number, col: number): void => {
    const next = sessionTable(runtime, { elementId: session.elementId, row, col });
    if (!next) {
      close();
      return;
    }
    setSession({ elementId: session.elementId, row, col });
    setValue(tableCellText(next, row, col));
  };

  const onKeyDown = (event: ReactKeyboardEvent): void => {
    if (event.key === "Escape") {
      // Stop the keystroke here: after the session closes, the same Escape must not reach the
      // select tool and clear the selection (the editor-close lesson).
      event.stopPropagation();
      commit(false);
      close();
      return;
    }
    if (event.key !== "Tab") return;
    event.preventDefault();
    event.stopPropagation();
    const destination = tabDestination(table, session.row, session.col, event.shiftKey);
    if (destination.kind === "close") {
      commit(false);
      close();
      return;
    }
    if (destination.kind === "append-row") {
      // Tab past the last cell grows the table: the row-append rides the commit's batch, then the
      // caret continues into the new row's first cell.
      commit(true);
      moveTo(destination.newRowIndex, 0);
      return;
    }
    commit(false);
    moveTo(destination.row, destination.col);
  };

  const camera = cameraStore.getCamera();
  const cell = tableCellRect(table, session.row, session.col)!;
  const topLeft = sceneToScreen({ x: table.x + cell.x, y: table.y + cell.y }, camera);
  const zoom = camera.zoom;

  return (
    <textarea
      ref={textareaRef}
      data-testid="table-cell-editor"
      value={value}
      maxLength={MAX_TABLE_CELL_CHARS}
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={onKeyDown}
      onBlur={() => {
        commit(false);
        close();
      }}
      style={{
        position: "absolute",
        left: topLeft.x,
        top: topLeft.y,
        width: cell.width * zoom,
        height: cell.height * zoom,
        padding: TABLE_CELL_PADDING * zoom,
        boxSizing: "border-box",
        border: "2px solid var(--dd-accent)",
        borderRadius: 2,
        background: "var(--dd-chrome-background-elevated)",
        color: "var(--dd-text-primary)",
        font: `${table.fontSize * zoom}px ${TEXT_FONT_FAMILY_CSS[table.fontFamily]}`,
        lineHeight: String(DEFAULT_TEXT_LINE_HEIGHT),
        resize: "none",
        outline: "none",
        overflow: "hidden",
        zIndex: 40,
      }}
    />
  );
}
