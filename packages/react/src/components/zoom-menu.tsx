/**
 * The zoom readout in the top bar, doubling as a dropdown of every zoom action — the pattern both
 * Excalidraw and tldraw use, and the fix for the readout previously being a bare button whose single
 * hidden behavior (zoom-to-fit) was discoverable only by hovering its `title`. Clicking now opens the
 * menu rather than firing one unlabelled action; `Shift+1` still runs zoom-to-fit directly.
 *
 * Every entry resolves through the shared `ActionRegistry`, so these rows, the command palette, and the
 * keyboard shortcuts stay one implementation (see `actions/action-types.ts`).
 */
import { useEffect, useRef, useState } from "react";
import { buttonStyle, panelStyle, RADIUS } from "./chrome-styles";
import { detectIsMac, formatShortcut } from "../actions/format-shortcut";
import { useTranslation } from "../i18n/use-translation";
import { useCameraVersion, useSelectionVersion } from "../runtime/use-live-version";
import type { CameraStore } from "../runtime/camera-store";
import type { DevivaRuntime } from "../runtime/runtime-types";

/** Zoom action ids listed in the dropdown, in menu order. */
const ZOOM_ACTION_IDS: readonly string[] = ["zoom-in", "zoom-out", "zoom-to-fit", "zoom-to-selection", "zoom-reset"];

export interface ZoomMenuProps {
  runtime: DevivaRuntime;
  cameraStore: CameraStore;
}

export function ZoomMenu(props: ZoomMenuProps) {
  const { runtime, cameraStore } = props;
  const { t } = useTranslation();
  useCameraVersion(cameraStore);
  // The zoom-to-selection row enables/disables with the selection, so the menu must re-render with it.
  useSelectionVersion(runtime.selection);
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const isMac = detectIsMac(typeof navigator !== "undefined" ? navigator.platform : undefined);
  const zoomPercent = Math.round(cameraStore.getCamera().zoom * 100);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  const renderRow = (id: string) => {
    const action = runtime.actionRegistry.get(id);
    if (!action) return null;
    const enabled = runtime.actionRegistry.isEnabled(id, runtime);
    return (
      <button
        key={id}
        type="button"
        role="menuitem"
        data-testid={`zoom-menu-${id}`}
        disabled={!enabled}
        aria-label={t(action.labelKey)}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          width: "100%",
          padding: "6px 10px",
          border: "none",
          borderRadius: RADIUS.control,
          font: "inherit",
          color: "var(--dd-text-primary)",
          cursor: enabled ? "pointer" : "default",
          opacity: enabled ? 1 : 0.45,
          textAlign: "left",
        }}
        onClick={() => {
          runtime.actionRegistry.run(id, runtime);
          setOpen(false);
        }}
      >
        <span>{t(action.labelKey)}</span>
        {action.shortcut && <span style={{ color: "var(--dd-text-secondary)", fontSize: 11 }}>{formatShortcut(action.shortcut, isMac)}</span>}
      </button>
    );
  };

  return (
    <div ref={wrapperRef} style={{ position: "relative", display: "inline-flex" }}>
      <button
        type="button"
        data-testid="top-bar-zoom-percentage"
        title={t("topbar.zoomMenu")}
        aria-label={t("topbar.zoomMenu")}
        aria-haspopup="true"
        aria-expanded={open}
        style={{ ...buttonStyle(false), minWidth: 44 }}
        onClick={() => setOpen((value) => !value)}
      >
        {t("topbar.zoomPercentage", { percent: zoomPercent })}
      </button>
      {open && (
        <div
          role="menu"
          data-testid="zoom-menu-popover"
          className="dd-animate-in"
          style={{ ...panelStyle, position: "absolute", top: "calc(100% + 8px)", left: 0, zIndex: 40, padding: 4, minWidth: 210, display: "flex", flexDirection: "column", gap: 2 }}
        >
          {ZOOM_ACTION_IDS.map(renderRow)}
        </div>
      )}
    </div>
  );
}
