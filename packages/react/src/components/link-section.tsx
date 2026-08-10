/**
 * Hyperlink control for the current selection — Excalidraw's "add link" affordance. The element data
 * model already carries `link: string | null` (see engine `base-element.ts`); this is the UI that
 * reads/writes it. A button opens a popover with a URL input plus Open/Remove; saving applies the
 * link to every selected element in one history batch. Only http/https URLs are accepted (a bare
 * `example.com` is upgraded to `https://`), and links open with `noopener,noreferrer` — never a
 * `javascript:`/`data:` scheme, which would be an XSS vector.
 */
import { useEffect, useRef, useState } from "react";
import { buttonStyle, inputStyle, panelStyle } from "./chrome-styles";
import { Icon } from "./icon";
import { normalizeLinkUrl } from "./link-url";
import { useTranslation } from "../i18n/use-translation";
import type { DevivaRuntime } from "../runtime/runtime-types";

export function LinkSection(props: { runtime: DevivaRuntime }) {
  const { runtime } = props;
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedElements = [...runtime.selection.getSelectedIds()]
    .map((id) => runtime.scene.getElement(id))
    .filter((element): element is NonNullable<typeof element> => !!element && !element.isDeleted);
  const currentLink = selectedElements.length === 1 ? selectedElements[0]!.link ?? "" : "";

  useEffect(() => {
    if (!open) return;
    setDraft(currentLink);
    const onPointerDown = (event: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
    // `currentLink` intentionally read once per open (seed the draft), not tracked across re-renders.
  }, [open]);

  const applyLink = (link: string | null) => {
    runtime.history.beginBatch();
    for (const element of selectedElements) runtime.scene.updateElement(element.id, { link });
    runtime.history.endBatch(runtime.scene.getElements());
  };

  const save = () => {
    applyLink(normalizeLinkUrl(draft));
    setOpen(false);
  };

  const openInNewTab = () => {
    const url = normalizeLinkUrl(draft || currentLink);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <button
        type="button"
        data-testid="link-button"
        aria-label={t("action.link")}
        title={t("action.link")}
        aria-pressed={currentLink.length > 0}
        style={{ ...buttonStyle(currentLink.length > 0), justifyContent: "flex-start", width: "100%" }}
        onClick={() => setOpen((previous) => !previous)}
      >
        <Icon name="link" />
        {t("action.link")}
      </button>
      {open && (
        <div
          className="dd-animate-in"
          data-testid="link-popover"
          style={{ ...panelStyle, position: "absolute", right: 0, top: "100%", marginTop: 6, zIndex: 20, padding: 10, width: 220, display: "flex", flexDirection: "column", gap: 8 }}
        >
          <input
            data-testid="link-input"
            aria-label={t("action.link")}
            placeholder="https://…"
            value={draft}
            autoFocus
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") save();
            }}
            style={{ ...inputStyle, padding: "6px 8px" }}
          />
          <div style={{ display: "flex", gap: 6 }}>
            <button type="button" data-testid="link-save" style={{ ...buttonStyle(false), flex: 1, justifyContent: "center" }} onClick={save}>
              {t("link.save")}
            </button>
            <button type="button" data-testid="link-open" aria-label={t("link.open")} title={t("link.open")} style={{ ...buttonStyle(false), justifyContent: "center" }} onClick={openInNewTab}>
              <Icon name="external-link" />
            </button>
            <button type="button" data-testid="link-remove" aria-label={t("link.remove")} title={t("link.remove")} style={{ ...buttonStyle(false), justifyContent: "center" }} onClick={() => { applyLink(null); setOpen(false); }}>
              <Icon name="trash" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
