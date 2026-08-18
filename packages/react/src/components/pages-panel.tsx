/**
 * Bottom-left page switcher: the current page's name opens a popover listing every page — click
 * switches, double-click renames inline, ✕ deletes (kept for >1 page only), and a + row appends a
 * fresh page. Multiple boards in one document is a workflow neither major competitor's core editor
 * offers, so this panel is deliberately quiet chrome: one small button until opened.
 */
import { useEffect, useReducer, useRef, useState } from "react";
import { Z_LAYER, panelStyle, buttonStyle, inputStyle } from "./chrome-styles";
import { Icon } from "./icon";
import { useTranslation } from "../i18n/use-translation";
import type { PageStore } from "../pages/page-store";

const PANEL_INSET = 8;

export interface PagesPanelProps {
  pageStore: PageStore;
  /** Parks the current camera, then activates `id` — see the shell's handler. */
  onSwitchPage(id: string): void;
  /** Parks the current camera, then appends + activates a fresh page — camera parking has to happen before `addPage` switches, which is why this isn't just `onSwitchPage(addPage())`. */
  onAddPage(): void;
  /** View-only hosts (the shared-scene viewer): switching stays available — a multi-page share needs navigating — but add/rename/delete disappear. */
  readOnly?: boolean;
}

export function PagesPanel(props: PagesPanelProps) {
  const { pageStore, onSwitchPage, onAddPage, readOnly = false } = props;
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Re-render on any page-list change (rename/add/delete/switch) — same pattern as `useSceneVersion`.
  const [, bump] = useReducer((count: number) => count + 1, 0);
  useEffect(() => pageStore.subscribe(() => bump()), [pageStore]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const pages = pageStore.getPages();
  const activeId = pageStore.getActivePageId();

  // Keep the active page inside the scroller's view — on open (the page you're on is the anchor you
  // navigate from) and whenever the active page changes while the list is up (adding appends the new,
  // now-active page below the fold of a long list).
  useEffect(() => {
    if (!open) return;
    scrollRef.current?.querySelector('[aria-checked="true"]')?.scrollIntoView({ block: "nearest" });
  }, [open, activeId]);
  const activeName = pages.find((page) => page.id === activeId)?.name ?? "";

  const commitRename = (id: string, name: string) => {
    pageStore.renamePage(id, name);
    setRenamingId(null);
  };

  return (
    <div ref={rootRef} style={{ position: "absolute", bottom: PANEL_INSET, left: PANEL_INSET, zIndex: Z_LAYER.menu }}>
      {open && (
        <div
          data-testid="pages-list"
          className="dd-animate-in"
          // Capped to the viewport (minus the top toolbar band and this panel's own bottom anchor) so a
          // long page list scrolls inside the popover instead of growing up past the window edge; the
          // "+ Add page" row stays pinned below the scroller so it never scrolls out of reach.
          style={{ ...panelStyle, position: "absolute", bottom: "calc(100% + 6px)", left: 0, minWidth: 180, maxHeight: "calc(100dvh - 140px)", padding: 4, display: "flex", flexDirection: "column" }}
        >
          <div ref={scrollRef} data-testid="pages-scroll" style={{ overflowY: "auto", minHeight: 0, display: "flex", flexDirection: "column" }}>
            {pages.map((page) => (
            <div key={page.id} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              {renamingId === page.id ? (
                <input
                  data-testid={`page-rename-${page.id}`}
                  defaultValue={page.name}
                  autoFocus
                  onFocus={(event) => event.target.select()}
                  onBlur={(event) => commitRename(page.id, event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") commitRename(page.id, (event.target as HTMLInputElement).value);
                    if (event.key === "Escape") setRenamingId(null);
                    event.stopPropagation();
                  }}
                  style={{ ...inputStyle, flex: 1, padding: "4px 6px", fontSize: 13, boxSizing: "border-box" }}
                />
              ) : (
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={page.id === activeId}
                  data-testid={`page-item-${page.id}`}
                  style={{ ...buttonStyle(page.id === activeId), flex: 1, justifyContent: "flex-start" }}
                  onClick={() => {
                    if (page.id !== activeId) onSwitchPage(page.id);
                  }}
                  onDoubleClick={() => {
                    if (!readOnly) setRenamingId(page.id);
                  }}
                  title={readOnly ? undefined : t("pages.renameHint")}
                >
                  {page.name}
                </button>
              )}
              {!readOnly && pages.length > 1 && (
                <button
                  type="button"
                  data-testid={`page-delete-${page.id}`}
                  aria-label={t("pages.delete")}
                  style={{ ...buttonStyle(false), padding: 4 }}
                  onClick={() => pageStore.removePage(page.id)}
                >
                  <Icon name="close" size={12} />
                </button>
              )}
            </div>
            ))}
          </div>
          {!readOnly && (
            <>
              <div style={{ height: 1, background: "var(--dd-chrome-border)", margin: "4px 0" }} />
              <button type="button" data-testid="page-add" style={{ ...buttonStyle(false), justifyContent: "flex-start", gap: 8 }} onClick={onAddPage}>
                <span aria-hidden style={{ fontSize: 13, lineHeight: 1 }}>+</span>
                {t("pages.add")}
              </button>
            </>
          )}
        </div>
      )}
      <button
        type="button"
        data-testid="pages-toggle"
        aria-expanded={open}
        aria-label={t("pages.title")}
        style={{ ...panelStyle, ...buttonStyle(false), display: "flex", alignItems: "center", gap: 6, padding: "6px 10px", fontSize: 12 }}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="file" size={13} />
        <span data-testid="pages-active-name">{activeName}</span>
        <span style={{ color: "var(--dd-text-secondary)", fontSize: 10 }}>{pages.length > 1 ? `${pages.findIndex((page) => page.id === activeId) + 1}/${pages.length}` : ""}</span>
      </button>
    </div>
  );
}
