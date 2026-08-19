/**
 * "Find on canvas" (Cmd+F): a search bar that steps through matches across the whole document,
 * revealing and selecting each one. Matching is delegated to the engine (`findTextMatches`, run per
 * page by `browser/find-across-pages.ts`) so standalone text, shape/note labels, table cells and
 * frame names are all found; a match that is a bound label reveals+selects its container (bound text
 * isn't independently selectable). The shell owns open/closed state and mounts this while open.
 *
 * Two behaviours here are worth knowing before editing:
 *
 * 1. **Switch-then-reveal.** Revealing a match on another page cannot happen in the same tick as the
 *    switch: `use-deviva-runtime` rebuilds the whole runtime around the new active `Scene`, so a
 *    reveal issued now would address the outgoing page's camera and selection. The match is parked in
 *    `pendingRevealRef` and consumed by an effect that runs once the active page id has actually
 *    changed — a deliberate pattern, not a timeout, and the first of its kind in this codebase (no
 *    other programmatic page swap sequences an action after the swap).
 * 2. **Escape restores the page you searched from.** Typing a query auto-reveals the first match,
 *    which may be on another page; abandoning the search should not silently leave the user there.
 *    Stepping to a match with Enter or the arrows counts as accepting it, and keeps that page.
 *
 * Embedders that mount without a page store still work: the panel falls back to searching the one
 * live scene, and nothing switches pages.
 */
import { computeElementsBounds, findTextMatches } from "@deviva-draw/engine";
import { useEffect, useMemo, useRef, useState } from "react";
import { Z_LAYER, buttonStyle, inputStyle, panelStyle } from "./chrome-styles";
import { Icon } from "./icon";
import { findMatchesAcrossPages } from "../browser/find-across-pages";
import type { PageMatch } from "../browser/find-across-pages";
import { useTranslation } from "../i18n/use-translation";
import type { PageStore } from "../pages/page-store";
import { usePagesVersion, useSceneVersion } from "../runtime/use-live-version";
import type { DevivaRuntime } from "../runtime/runtime-types";

export function FindPanel(props: { runtime: DevivaRuntime; pageStore?: PageStore | null; onSwitchPage?: (pageId: string) => void; onClose(): void }) {
  const { runtime, pageStore = null, onSwitchPage, onClose } = props;
  const { t } = useTranslation();
  const sceneVersion = useSceneVersion(runtime.scene); // recompute matches when the scene changes underneath the search
  const pagesVersion = usePagesVersion(pageStore); // …and when pages are added/renamed/removed, or the active one changes
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);

  const activePageId = pageStore?.getActivePageId() ?? null;
  // The page the search started on, restored if the panel closes without a match being accepted.
  const originPageIdRef = useRef(activePageId);
  const acceptedRef = useRef(false);
  const pendingRevealRef = useRef<PageMatch | null>(null);

  const matches = useMemo<PageMatch[]>(() => {
    if (pageStore) return findMatchesAcrossPages(pageStore, query);
    // No page store (an embedder mounting the canvas on its own): the single live scene is the whole
    // document, so there is no page to attribute a match to and nothing to switch to.
    return findTextMatches(runtime.scene, query).map((elementId) => ({ pageId: activePageId ?? "", pageName: "", elementId }));
    // Deps carry the version counters deliberately: they are the change signal for the mutable
    // stores read above, which React cannot see into.
  }, [pageStore, runtime.scene, query, sceneVersion, pagesVersion, activePageId]);

  const revealOnActivePage = (match: PageMatch) => {
    const element = runtime.scene.getElement(match.elementId);
    if (!element) return;
    // A bound label can't be selected on its own — reveal and select its container instead.
    const target = element.type === "text" && element.containerId ? runtime.scene.getElement(element.containerId) ?? element : element;
    const bounds = computeElementsBounds([target]);
    if (bounds) runtime.panZoomTool.revealRect(bounds);
    if (!(target.type === "text" && target.containerId)) runtime.selection.selectOnly([target.id]);
  };

  const reveal = (matchIndex: number) => {
    const match = matches[matchIndex];
    if (!match) return;
    if (match.pageId !== "" && match.pageId !== activePageId && onSwitchPage) {
      pendingRevealRef.current = match;
      onSwitchPage(match.pageId);
      return;
    }
    revealOnActivePage(match);
  };

  // Consumes a reveal parked by `reveal` once the page switch has actually landed — see the module
  // doc. Keyed on the runtime too: the switch replaces it, and revealing against the outgoing
  // runtime's scene is the exact race this exists to avoid.
  useEffect(() => {
    const pending = pendingRevealRef.current;
    if (!pending || pending.pageId !== activePageId) return;
    pendingRevealRef.current = null;
    revealOnActivePage(pending);
  }, [activePageId, runtime]);

  // On each new query, jump to the first match. (Intentionally keyed on `query` only — `reveal`/
  // `matches` are recomputed every render and re-running this on their identity would loop.)
  useEffect(() => {
    setIndex(0);
    if (matches.length > 0) reveal(0);
  }, [query]);

  const step = (delta: number) => {
    if (matches.length === 0) return;
    acceptedRef.current = true; // an explicit step is the user choosing this match, and its page
    const next = (index + delta + matches.length) % matches.length;
    setIndex(next);
    reveal(next);
  };

  const close = () => {
    const originPageId = originPageIdRef.current;
    if (!acceptedRef.current && originPageId !== null && originPageId !== activePageId && onSwitchPage) onSwitchPage(originPageId);
    onClose();
  };

  const currentMatch = matches[index];
  const showPageLabel = currentMatch !== undefined && currentMatch.pageName !== "";

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
          else if (event.key === "Escape") close();
        }}
        style={{ ...inputStyle, padding: "6px 8px", width: 200 }}
      />
      <span data-testid="find-count" style={{ fontSize: 12, color: "var(--dd-text-secondary)", minWidth: 56, textAlign: "center" }}>
        {query.length === 0 ? "" : matches.length === 0 ? t("find.noResults") : t("find.matches").replace("{index}", String(index + 1)).replace("{count}", String(matches.length))}
      </span>
      {showPageLabel && (
        <span data-testid="find-page" title={t("find.onPage").replace("{page}", currentMatch.pageName)} style={{ fontSize: 12, color: "var(--dd-text-secondary)", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {t("find.onPage").replace("{page}", currentMatch.pageName)}
        </span>
      )}
      <button type="button" data-testid="find-prev" aria-label={t("find.previous")} title={t("find.previous")} disabled={matches.length === 0} style={{ ...buttonStyle(false), justifyContent: "center" }} onClick={() => step(-1)}>
        <Icon name="chevron-up" />
      </button>
      <button type="button" data-testid="find-next" aria-label={t("find.next")} title={t("find.next")} disabled={matches.length === 0} style={{ ...buttonStyle(false), justifyContent: "center" }} onClick={() => step(1)}>
        <Icon name="chevron-down" />
      </button>
      <button type="button" data-testid="find-close" aria-label={t("find.close")} title={t("find.close")} style={{ ...buttonStyle(false), justifyContent: "center" }} onClick={close}>
        <Icon name="close" />
      </button>
    </div>
  );
}
