/**
 * The stats panel behind the main-menu "Toggle stats panel": document facts (element count, zoom)
 * plus — with a single element selected — editable position/size/angle number inputs, so exact
 * values can be typed instead of nudged. Multi-selections show their combined bounds read-only
 * (editing them means a group transform; typing one number into that is ambiguous, so it waits).
 *
 * Each commit (Enter/blur) is one history batch. Size edits clamp to the engine minimum; linear
 * elements (points-based: lines, arrows, freedraw) only expose X/Y — their width/height derive from
 * their points, and writing the box without rescaling the points would tear the geometry.
 */
import { MIN_ELEMENT_SIZE, selectionBoundsOf } from "@deviva-draw/engine";
import type { AnyElement } from "@deviva-draw/engine";
import { useState } from "react";
import { panelStyle, inputStyle, labelStyle } from "./chrome-styles";
import { useCameraVersion, useSceneVersion, useSelectionVersion } from "../runtime/use-live-version";
import { useTranslation } from "../i18n/use-translation";
import type { CameraStore } from "../runtime/camera-store";
import type { DevivaRuntime } from "../runtime/runtime-types";

/** Sits above the minimap (bottom-right, 130px tall + insets). */
const PANEL_BOTTOM = 154;

const toDegrees = (radians: number) => Math.round(((radians * 180) / Math.PI) % 360);
const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

export function StatsPanel(props: { runtime: DevivaRuntime; cameraStore: CameraStore }) {
  const { runtime, cameraStore } = props;
  const { t } = useTranslation();
  useSceneVersion(runtime.scene);
  useSelectionVersion(runtime.selection);
  useCameraVersion(cameraStore);

  const live = runtime.scene.getElements().filter((element) => !element.isDeleted);
  const selected = live.filter((element) => runtime.selection.isSelected(element.id));
  const single = selected.length === 1 ? selected[0]! : null;
  const bounds = selected.length > 1 ? selectionBoundsOf(selected) : null;
  const zoom = Math.round(cameraStore.getCamera().zoom * 100);

  const apply = (changes: Partial<AnyElement>) => {
    if (!single) return;
    runtime.history.beginBatch();
    runtime.scene.updateElement(single.id, changes);
    runtime.history.endBatch(runtime.scene.getElements());
  };
  const isLinear = single !== null && "points" in single;

  return (
    <div data-testid="stats-panel" style={{ ...panelStyle, position: "absolute", bottom: PANEL_BOTTOM, right: 8, width: 180, padding: 10, display: "flex", flexDirection: "column", gap: 6, fontSize: 12, zIndex: 25 }}>
      <div style={{ display: "flex", justifyContent: "space-between", color: "var(--dd-text-secondary)" }}>
        <span>{t("stats.elements")}</span>
        <span data-testid="stats-element-count">{live.length}</span>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", color: "var(--dd-text-secondary)" }}>
        <span>{t("stats.zoom")}</span>
        <span>{zoom}%</span>
      </div>
      {single && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 2 }}>
          <StatField label="X" testId="stats-x" value={Math.round(single.x)} onCommit={(value) => apply({ x: value })} />
          <StatField label="Y" testId="stats-y" value={Math.round(single.y)} onCommit={(value) => apply({ y: value })} />
          {!isLinear && (
            <>
              <StatField label="W" testId="stats-w" value={Math.round(single.width)} onCommit={(value) => apply({ width: Math.max(MIN_ELEMENT_SIZE, value) })} />
              <StatField label="H" testId="stats-h" value={Math.round(single.height)} onCommit={(value) => apply({ height: Math.max(MIN_ELEMENT_SIZE, value) })} />
              <StatField label="∠°" testId="stats-angle" value={toDegrees(single.angle)} onCommit={(value) => apply({ angle: toRadians(value) })} />
            </>
          )}
        </div>
      )}
      {bounds && (
        <div data-testid="stats-multi-bounds" style={{ color: "var(--dd-text-secondary)" }}>
          {selected.length} × · {Math.round(bounds.width)} × {Math.round(bounds.height)}
        </div>
      )}
    </div>
  );
}

/**
 * One labeled number input. Local draft state while focused, re-seeded from the live value via `key`
 * on the element/value identity — so outside changes (dragging the shape) refresh the field, but
 * typing is never clobbered mid-edit by the re-render its own commit causes.
 */
function StatField(props: { label: string; testId: string; value: number; onCommit(value: number): void }) {
  const { label, testId, value, onCommit } = props;
  const [draft, setDraft] = useState<string | null>(null);

  const commit = () => {
    if (draft === null) return;
    const parsed = Number(draft);
    if (Number.isFinite(parsed) && parsed !== value) onCommit(parsed);
    setDraft(null);
  };

  return (
    <label style={{ ...labelStyle, display: "flex", alignItems: "center", gap: 4 }}>
      <span style={{ width: 18 }}>{label}</span>
      <input
        data-testid={testId}
        type="number"
        value={draft ?? String(value)}
        onChange={(event) => setDraft(event.target.value)}
        onFocus={(event) => event.target.select()}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
          event.stopPropagation(); // typing digits must not switch tools
        }}
        style={{ ...inputStyle, flex: 1, minWidth: 0, padding: "2px 4px", fontSize: 12, boxSizing: "border-box" }}
      />
    </label>
  );
}
