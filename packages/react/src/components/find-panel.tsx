/**
 * "Find on canvas" (Excalidraw's Cmd+F): a search bar that steps through text matches, revealing and
 * selecting each one. Matching is delegated to the engine (`findTextMatches`) so standalone text and
 * shape/note labels are both found; a match that is a bound label reveals+selects its container (bound
 * text isn't independently selectable). The shell owns open/closed state and mounts this while open.
 */
import { computeElementsBounds, findTextMatches } from "@deviva-draw/engine";
import { useEffect, useMemo, useState } from "react";
import { Z_LAYER, buttonStyle, inputStyle, panelStyle } from "./chrome-styles";
import { Icon } from "./icon";
import { useTranslation } from "../i18n/use-translation";
import { useSceneVersion } from "../runtime/use-live-version";
import type { DevivaRuntime } from "../runtime/runtime-types";

export function FindPanel(props: { runtime: DevivaRuntime; onClose(): void }) {
  const { runtime, onClose } = props;
  const { t } = useTranslation();
  const sceneVersion = useSceneVersion(runtime.scene); // recompute matches when the scene changes underneath the search
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);

  const matches = useMemo(() => findTextMatches(runtime.scene, query), [runtime.scene, query, sceneVersion]);

  const reveal = (matchIndex: number) => {
    const id = matches[matchIndex];
    if (!id) return;
    const element = runtime.scene.getElement(id);
    if (!element) return;
    // A bound label can't be selected on its own — reveal and select its container instead.
    const target = element.type === "text" && element.containerId ? runtime.scene.getElement(element.containerId) ?? element : element;
    const bounds = computeElementsBounds([target]);
    if (bounds) runtime.panZoomTool.revealRect(bounds);
    if (!(target.type === "text" && target.containerId)) runtime.selection.selectOnly([target.id]);
  };

  // On each new query, jump to the first match. (Intentionally keyed on `query` only — `reveal`/
  // `matches` are recomputed every render and re-running this on their identity would loop.)
  useEffect(() => {
    setIndex(0);
    if (matches.length > 0) reveal(0);
  }, [query]);

  const step = (delta: number) => {
    if (matches.length === 0) return;
    const next = (index + delta + matches.length) % matches.length;
    setIndex(next);
    reveal(next);
  };

  return (
    <div
      className="dd-animate-in"
      data-testid="find-panel"
      role="search"
      style={{ ...panelStyle, position: "absolute", top: 12, left: "50%", transform: "translateX(-50%)", zIndex: Z_LAYER.findPanel, padding: 6, display: "flex", alignItems: "center", gap: 6 }}
    >
      <input
        data-testid="find-input"
        aria-label={t("find.placeholder")}
        placeholder={t("find.placeholder")}
        value={query}
        autoFocus
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") step(event.shiftKey ? -1 : 1);
          else if (event.key === "Escape") onClose();
        }}
        style={{ ...inputStyle, padding: "6px 8px", width: 200 }}
      />
      <span data-testid="find-count" style={{ fontSize: 12, color: "var(--dd-text-secondary)", minWidth: 56, textAlign: "center" }}>
        {query.length === 0 ? "" : matches.length === 0 ? t("find.noResults") : t("find.matches").replace("{index}", String(index + 1)).replace("{count}", String(matches.length))}
      </span>
      <button type="button" data-testid="find-prev" aria-label={t("find.previous")} title={t("find.previous")} disabled={matches.length === 0} style={{ ...buttonStyle(false), justifyContent: "center" }} onClick={() => step(-1)}>
        <Icon name="chevron-up" />
      </button>
      <button type="button" data-testid="find-next" aria-label={t("find.next")} title={t("find.next")} disabled={matches.length === 0} style={{ ...buttonStyle(false), justifyContent: "center" }} onClick={() => step(1)}>
        <Icon name="chevron-down" />
      </button>
      <button type="button" data-testid="find-close" aria-label={t("find.close")} title={t("find.close")} style={{ ...buttonStyle(false), justifyContent: "center" }} onClick={onClose}>
        <Icon name="close" />
      </button>
    </div>
  );
}
