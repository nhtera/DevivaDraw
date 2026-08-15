/**
 * The layers panel: the active page's layers listed TOP-first (matching visual stacking), each row
 * with an eye (visibility), a lock, an inline-renameable name (double-click, the pages-panel
 * pattern), reorder arrows, delete, and — while a selection exists — a "move selection here"
 * shortcut. Clicking a row makes it the active layer new elements land on.
 *
 * Talks to the engine's layer ops on `Scene` directly (the pages-panel interaction model: direct
 * store calls + a subscribe/bump re-render, not parameterized registry actions). View-only safety
 * is NOT this component's job — the shell unmounts it entirely in view-only, the structural
 * PropertiesPanel pattern, so no per-control guard can be forgotten here.
 *
 * The footer hint states the plan's non-goal out loud: hiding controls what's SHOWN, not what a
 * share or file contains — recipients with edit access can unhide.
 */
import { useEffect, useReducer, useState } from "react";
import { buttonStyle, chromeFontFamily, inputStyle, panelStyle } from "./chrome-styles";
import { Icon } from "./icon";
import { useTranslation } from "../i18n/use-translation";
import { useSelectionVersion } from "../runtime/use-live-version";
import type { DevivaRuntime } from "../runtime/runtime-types";

export interface LayersPanelProps {
  runtime: DevivaRuntime;
}

export function LayersPanel(props: LayersPanelProps) {
  const { runtime } = props;
  const scene = runtime.scene;
  const { t } = useTranslation();
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [, bump] = useReducer((count: number) => count + 1, 0);
  // Layer ops, element churn, and remote mutations all arrive through the scene's one signal; the
  // selection has its own — without it, a pure click-select (no scene mutation) would never toggle
  // the per-row "move selection here" buttons.
  useEffect(() => scene.subscribe(() => bump()), [scene]);
  useSelectionVersion(runtime.selection);

  const layers = [...scene.getLayers()].reverse(); // top-first, matching what stacks above what
  const activeId = scene.getActiveLayerId();
  const hasSelection = runtime.selection.getSelectedIds().size > 0;

  const commitRename = (id: string, name: string) => {
    scene.renameLayer(id, name);
    setRenamingId(null);
  };

  /** Deleting re-homes the layer's elements to its lower neighbor (or upper, for the bottom layer) — content is moved, never destroyed. */
  const deleteLayer = (id: string) => {
    const bottomToTop = scene.getLayers();
    const position = bottomToTop.findIndex((layer) => layer.id === id);
    const neighbor = bottomToTop[position - 1] ?? bottomToTop[position + 1];
    if (!neighbor) return;
    runtime.history.beginBatch();
    scene.removeLayer(id, neighbor.id);
    runtime.history.endBatch(scene.getElements());
  };

  const moveSelectionTo = (layerId: string) => {
    const destination = layerId === scene.getDefaultLayerId() ? undefined : layerId;
    runtime.history.beginBatch();
    for (const id of runtime.selection.getSelectedIds()) scene.updateElement(id, { layerId: destination });
    runtime.history.endBatch(scene.getElements());
    // Moving onto a locked/hidden layer would strand the selection — the prune subscriber handles
    // it, but re-selecting explicitly keeps the interaction predictable when the target is normal.
  };

  return (
    <div
      data-testid="layers-panel"
      className="dd-animate-in"
      style={{ ...panelStyle, position: "absolute", top: 76, right: "calc(8px + var(--dd-library-sidebar-width, 0px))", width: 200, padding: 6, zIndex: 25, display: "flex", flexDirection: "column", gap: 4, fontFamily: chromeFontFamily, fontSize: 12 }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <strong style={{ fontSize: 12 }}>{t("layers.title")}</strong>
        <button type="button" data-testid="layers-add" aria-label={t("layers.add")} style={{ ...buttonStyle(false), padding: "2px 8px" }} onClick={() => scene.setActiveLayer(scene.addLayer().id)}>
          +
        </button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 2, maxHeight: 260, overflowY: "auto" }}>
        {layers.map((layer, topFirstIndex) => (
          <div key={layer.id} data-testid={`layer-row-${layer.id}`} style={{ display: "flex", alignItems: "center", gap: 2 }}>
            <button
              type="button"
              data-testid={`layer-visible-${layer.id}`}
              aria-label={t(layer.visible ? "layers.hide" : "layers.show")}
              aria-pressed={layer.visible}
              style={{ ...buttonStyle(false), padding: "2px 4px", opacity: layer.visible ? 1 : 0.5 }}
              onClick={() => scene.setLayerVisible(layer.id, !layer.visible)}
            >
              <Icon name={layer.visible ? "eye" : "eye-off"} size={12} />
            </button>
            <button
              type="button"
              data-testid={`layer-locked-${layer.id}`}
              aria-label={t(layer.locked ? "layers.unlock" : "layers.lock")}
              aria-pressed={layer.locked}
              style={{ ...buttonStyle(false), padding: "2px 4px", opacity: layer.locked ? 1 : 0.5 }}
              onClick={() => scene.setLayerLocked(layer.id, !layer.locked)}
            >
              <Icon name={layer.locked ? "lock" : "unlock"} size={12} />
            </button>
            {renamingId === layer.id ? (
              <input
                data-testid={`layer-rename-${layer.id}`}
                defaultValue={layer.name}
                autoFocus
                onFocus={(event) => event.target.select()}
                onBlur={(event) => commitRename(layer.id, event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") commitRename(layer.id, (event.target as HTMLInputElement).value);
                  if (event.key === "Escape") setRenamingId(null);
                  event.stopPropagation();
                }}
                style={{ ...inputStyle, flex: 1, minWidth: 0, padding: "2px 4px", fontSize: 12, boxSizing: "border-box" }}
              />
            ) : (
              <button
                type="button"
                role="radio"
                aria-checked={layer.id === activeId}
                data-testid={`layer-item-${layer.id}`}
                title={t("layers.renameHint")}
                style={{ ...buttonStyle(layer.id === activeId), flex: 1, minWidth: 0, justifyContent: "flex-start", padding: "2px 6px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                onClick={() => scene.setActiveLayer(layer.id)}
                onDoubleClick={() => setRenamingId(layer.id)}
              >
                {layer.name}
              </button>
            )}
            {hasSelection && (
              <button
                type="button"
                data-testid={`layer-move-here-${layer.id}`}
                aria-label={t("layers.moveSelectionHere")}
                title={t("layers.moveSelectionHere")}
                style={{ ...buttonStyle(false), padding: "2px 4px" }}
                onClick={() => moveSelectionTo(layer.id)}
              >
                ⤶
              </button>
            )}
            <button
              type="button"
              data-testid={`layer-move-up-${layer.id}`}
              aria-label={t("layers.moveUp")}
              disabled={topFirstIndex === 0}
              style={{ ...buttonStyle(false), padding: "2px 3px" }}
              onClick={() => scene.moveLayer(layer.id, 1)}
            >
              <Icon name="layer-up" size={11} />
            </button>
            <button
              type="button"
              data-testid={`layer-move-down-${layer.id}`}
              aria-label={t("layers.moveDown")}
              disabled={topFirstIndex === layers.length - 1}
              style={{ ...buttonStyle(false), padding: "2px 3px" }}
              onClick={() => scene.moveLayer(layer.id, -1)}
            >
              <Icon name="layer-down" size={11} />
            </button>
            {layers.length > 1 && (
              <button type="button" data-testid={`layer-delete-${layer.id}`} aria-label={t("layers.delete")} style={{ ...buttonStyle(false), padding: "2px 4px" }} onClick={() => deleteLayer(layer.id)}>
                <Icon name="close" size={11} />
              </button>
            )}
          </div>
        ))}
      </div>
      <p style={{ margin: 0, fontSize: 10, color: "var(--dd-text-secondary)" }}>{t("layers.notRedactionHint")}</p>
    </div>
  );
}
