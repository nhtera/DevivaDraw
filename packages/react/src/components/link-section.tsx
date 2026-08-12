/**
 * Hyperlink control for the current selection — Excalidraw's "add link" affordance. The element data
 * model already carries `link: string | null` (see engine `base-element.ts`); this is the UI that
 * reads/writes it. A button opens a popover with a URL input plus Open/Remove; saving applies the
 * link to every selected element in one history batch. Only http/https URLs are accepted (a bare
 * `example.com` is upgraded to `https://`), and links open with `noopener,noreferrer` — never a
 * `javascript:`/`data:` scheme, which would be an XSS vector.
 *
 * The popover is portalled out to the app root (see `popover-portal-host.ts`) and positioned in
 * viewport coordinates, matching `color-picker.tsx`. It cannot be a plain absolutely-positioned child: the properties panel is a
 * scroll container (`overflow-y: auto`, which makes the browser compute `overflow-x: auto` too), so an
 * in-flow popover gets clipped at the panel's edges — and this one is wider than the panel's content
 * box, so it was clipped on the left.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { buttonStyle, inputStyle, panelStyle } from "./chrome-styles";
import { Icon } from "./icon";
import { normalizeLinkUrl } from "./link-url";
import { popoverPortalHost } from "./popover-portal-host";
import { useTranslation } from "../i18n/use-translation";
import type { DevivaRuntime } from "../runtime/runtime-types";

/** Popover width; also the basis for clamping it inside the viewport. */
const POPOVER_WIDTH = 220;
/** Minimum gap kept between the popover and any viewport edge. */
const VIEWPORT_MARGIN = 8;

export function LinkSection(props: { runtime: DevivaRuntime }) {
  const { runtime } = props;
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number } | null>(null);

  const selectedElements = [...runtime.selection.getSelectedIds()]
    .map((id) => runtime.scene.getElement(id))
    .filter((element): element is NonNullable<typeof element> => !!element && !element.isDeleted);
  const currentLink = selectedElements.length === 1 ? selectedElements[0]!.link ?? "" : "";

  // Right-aligned to the trigger, flipped above it when there is no room below, and always clamped
  // inside the viewport — the popover no longer inherits the panel's clipping, so it must not run off
  // the screen either.
  useLayoutEffect(() => {
    if (!open) {
      setPopoverPos(null);
      return;
    }
    const trigger = containerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const left = Math.max(VIEWPORT_MARGIN, Math.min(rect.right - POPOVER_WIDTH, window.innerWidth - POPOVER_WIDTH - VIEWPORT_MARGIN));
    const popHeight = popoverRef.current?.offsetHeight ?? 0;
    const below = rect.bottom + 6;
    const top = popHeight > 0 && below + popHeight > window.innerHeight - VIEWPORT_MARGIN ? Math.max(VIEWPORT_MARGIN, rect.top - 6 - popHeight) : below;
    setPopoverPos({ top, left });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setDraft(currentLink);
    const onPointerDown = (event: PointerEvent) => {
      const insideTrigger = containerRef.current?.contains(event.target as Node);
      const insidePopover = popoverRef.current?.contains(event.target as Node);
      if (!insideTrigger && !insidePopover) setOpen(false);
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
      {open && createPortal(
        <div
          ref={popoverRef}
          className="dd-animate-in"
          data-testid="link-popover"
          style={{
            ...panelStyle,
            position: "fixed",
            top: popoverPos?.top ?? 0,
            left: popoverPos?.left ?? 0,
            visibility: popoverPos ? "visible" : "hidden",
            zIndex: 60,
            padding: 10,
            width: POPOVER_WIDTH,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
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
        </div>,
        popoverPortalHost(containerRef.current),
      )}
    </div>
  );
}
