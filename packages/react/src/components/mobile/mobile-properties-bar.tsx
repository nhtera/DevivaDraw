/**
 * Narrow-viewport dock for the style controls (replaces the desktop top-right `PropertiesPanel`, which
 * on a phone covers most of the screen). A compact bar sits just above the bottom tool row showing the
 * live stroke + background swatches and a "Style" (sliders) toggle; tapping any of them opens the full
 * `PropertiesPanelBody` in a bottom sheet (scrollable, capped height) so the canvas stays visible —
 * matching how Excalidraw handles mobile properties. Same visibility rule as the desktop panel
 * (`isPropertiesPanelHidden`): nothing to style → the whole bar is hidden.
 */
import { useEffect, useReducer, useState } from "react";
import { panelStyle, buttonStyle, labelStyle } from "../chrome-styles";
import { Icon } from "../icon";
import { PropertiesPanelBody, currentDisplayStyle, isPropertiesPanelHidden } from "../properties-panel-body";
import { useSceneVersion, useSelectionVersion, useToolVersion } from "../../runtime/use-live-version";
import { useTranslation } from "../../i18n/use-translation";
import type { DevivaRuntime } from "../../runtime/runtime-types";

const TRANSPARENT_BG = "repeating-conic-gradient(#ccc 0% 25%, transparent 0% 50%) 50% / 8px 8px";

function swatchBackground(color: string): string {
  return color === "transparent" ? TRANSPARENT_BG : color;
}

/** A live style swatch (stroke/background) that opens the full sheet — doubles as an at-a-glance current-color indicator. */
function SwatchChip(props: { color: string; label: string; testId: string; onClick(): void }) {
  const { color, label, testId, onClick } = props;
  return (
    <button
      type="button"
      data-testid={testId}
      aria-label={label}
      title={label}
      onClick={onClick}
      style={{ width: 30, height: 30, borderRadius: 7, border: "1px solid var(--dd-chrome-border)", background: swatchBackground(color), cursor: "pointer", padding: 0, flex: "0 0 auto" }}
    />
  );
}

export interface MobilePropertiesBarProps {
  runtime: DevivaRuntime;
}

export function MobilePropertiesBar(props: MobilePropertiesBarProps) {
  const { runtime } = props;
  const { t } = useTranslation();
  useSceneVersion(runtime.scene);
  useSelectionVersion(runtime.selection);
  useToolVersion(runtime.toolStateMachine);
  const [, forceRender] = useReducer((count: number) => count + 1, 0);
  const [sheetOpen, setSheetOpen] = useState(false);

  // Re-render when a text-edit session opens/closes (opening mutates no scene state, so the version
  // hooks alone wouldn't switch the bar between shape/text/hidden).
  useEffect(() => runtime.editSession.subscribe(forceRender), [runtime.editSession]);

  const hidden = isPropertiesPanelHidden(runtime);
  // Nothing to style → collapse the sheet too, so it never lingers after the bar disappears.
  useEffect(() => {
    if (hidden) setSheetOpen(false);
  }, [hidden]);

  // Close the sheet on Escape (keyboard users / external keyboards on tablets).
  useEffect(() => {
    if (!sheetOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Defer to an open color-picker popover: its own Escape handler closes it first, so one press
      // shouldn't also collapse the whole sheet.
      if (document.querySelector('[data-testid$="color-popover"]')) return;
      setSheetOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [sheetOpen]);

  if (hidden) return null;

  const style = currentDisplayStyle(runtime);
  const openSheet = () => setSheetOpen(true);

  return (
    <>
      {sheetOpen && (
        <>
          {/* Transparent tap-catcher over the canvas: closes on an outside tap without dimming. Sits BELOW
              the tool row (z-index 20) and this bar/sheet (26) so switching tools keeps the sheet open,
              matching Excalidraw — only a tap on the canvas/top-bar area dismisses it. */}
          <div data-testid="mobile-properties-scrim" onClick={() => setSheetOpen(false)} style={{ position: "fixed", inset: 0, background: "transparent", zIndex: 18 }} />
          <div
            className="dd-animate-in"
            data-testid="mobile-properties-sheet"
            role="dialog"
            aria-label={t("mobile.styleOptions")}
            // Centered via auto margins (not `translateX(-50%)`) so the `dd-animate-in` pop — which
            // animates `transform` — doesn't momentarily drop the centering and fling the sheet right.
            style={{
              ...panelStyle,
              position: "fixed",
              left: 0,
              right: 0,
              marginInline: "auto",
              bottom: 112,
              width: "min(360px, calc(100vw - 16px))",
              maxHeight: "min(60vh, calc(100vh - 180px))",
              overflowY: "auto",
              padding: 12,
              display: "flex",
              flexDirection: "column",
              gap: 10,
              zIndex: 26,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ ...labelStyle, marginBottom: 0, fontWeight: 600 }}>{t("mobile.style")}</span>
              <button type="button" aria-label={t("shortcuts.close")} onClick={() => setSheetOpen(false)} style={{ ...buttonStyle(false), padding: 4 }}>
                <Icon name="close" />
              </button>
            </div>
            <PropertiesPanelBody runtime={runtime} onAfterApply={forceRender} />
          </div>
        </>
      )}
      <div
        role="toolbar"
        aria-label={t("mobile.styleOptions")}
        data-testid="mobile-properties-bar"
        style={{ ...panelStyle, display: "flex", alignItems: "center", gap: 8, padding: 6, position: "fixed", bottom: 64, left: "50%", transform: "translateX(-50%)", maxWidth: "calc(100vw - 16px)", zIndex: 26 }}
      >
        <SwatchChip color={style.strokeColor} label={t("panel.stroke")} testId="mobile-stroke-swatch" onClick={openSheet} />
        <SwatchChip color={style.backgroundColor} label={t("panel.background")} testId="mobile-background-swatch" onClick={openSheet} />
        <div style={{ width: 1, height: 22, background: "var(--dd-chrome-border)" }} />
        <button
          type="button"
          data-testid="mobile-properties-toggle"
          aria-label={t("mobile.styleOptions")}
          aria-pressed={sheetOpen}
          onClick={() => setSheetOpen((previous) => !previous)}
          style={{ ...buttonStyle(sheetOpen), gap: 6, padding: "6px 10px" }}
        >
          <Icon name="sliders" size={18} />
          {t("mobile.style")}
        </button>
      </div>
    </>
  );
}
