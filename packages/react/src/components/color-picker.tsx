/**
 * Color picker for a single style field (stroke or background). A quick-access row of palette + recent
 * swatches stays inline; a trigger (the current-color chip) opens a popover with the full palette, a
 * lightness ramp ("shades") of the active color, a hex input, and — where the browser supports it — an
 * eyedropper. Palette/recent come from the engine's defaults + `ShapeStyleState.getRecentColors()`.
 */
import { useEffect, useRef, useState } from "react";
import { RADIUS, inputStyle, labelStyle, panelStyle } from "./chrome-styles";
import { generateShades, isValidHex, normalizeHex } from "./color-utils";

interface EyeDropperResult {
  sRGBHex: string;
}
interface EyeDropperInstance {
  open(): Promise<EyeDropperResult>;
}
declare global {
  interface Window {
    EyeDropper?: { new (): EyeDropperInstance };
  }
}

export interface ColorPickerProps {
  label: string;
  value: string;
  palette: readonly string[];
  recentColors: readonly string[];
  onChange(color: string): void;
  customColorLabel: string;
  /** Prefixes the popover trigger + hex/eyedropper `data-testid`s so e2e can target a specific picker (e.g. `"stroke-color"`). */
  testId?: string;
}

const SWATCH_SIZE = 20;
const TRANSPARENT_BG = "repeating-conic-gradient(#ccc 0% 25%, transparent 0% 50%) 50% / 8px 8px";

function swatchBackground(color: string): string {
  return color === "transparent" ? TRANSPARENT_BG : color;
}

function Swatch(props: { color: string; selected: boolean; onClick: () => void; size?: number }) {
  const { color, selected, onClick, size = SWATCH_SIZE } = props;
  return (
    <button
      type="button"
      onClick={onClick}
      title={color}
      style={{
        width: size,
        height: size,
        borderRadius: 5,
        border: selected ? "2px solid var(--dd-accent)" : "1px solid var(--dd-chrome-border)",
        background: swatchBackground(color),
        cursor: "pointer",
        padding: 0,
      }}
    />
  );
}

export function ColorPicker(props: ColorPickerProps) {
  const { label, value, palette, recentColors, onChange, customColorLabel, testId } = props;
  const [open, setOpen] = useState(false);
  const [hexDraft, setHexDraft] = useState(value);
  const containerRef = useRef<HTMLDivElement>(null);
  const uniqueRecent = recentColors.filter((color) => !palette.includes(color)).slice(0, 8);
  const shades = generateShades(value);
  const eyedropperSupported = typeof window !== "undefined" && typeof window.EyeDropper === "function";

  useEffect(() => setHexDraft(value), [value]);

  useEffect(() => {
    if (!open) return;
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
  }, [open]);

  const commitHex = () => {
    if (isValidHex(hexDraft)) onChange(normalizeHex(hexDraft));
    else setHexDraft(value);
  };

  const pickWithEyedropper = () => {
    const Ctor = window.EyeDropper;
    if (!Ctor) return;
    new Ctor()
      .open()
      .then((result) => onChange(result.sRGBHex))
      .catch(() => {
        /* user dismissed the eyedropper — nothing to do */
      });
  };

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <span style={labelStyle}>{label}</span>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
        {palette.map((color) => (
          <Swatch key={color} color={color} selected={value === color} onClick={() => onChange(color)} />
        ))}
        {uniqueRecent.map((color) => (
          <Swatch key={color} color={color} selected={value === color} onClick={() => onChange(color)} />
        ))}
        <button
          type="button"
          data-testid={testId ? `${testId}-more` : undefined}
          aria-label={customColorLabel}
          title={customColorLabel}
          onClick={() => setOpen((previous) => !previous)}
          style={{ width: SWATCH_SIZE, height: SWATCH_SIZE, borderRadius: 5, border: "1px solid var(--dd-chrome-border)", background: swatchBackground(value), cursor: "pointer", padding: 0, boxShadow: "inset 0 0 0 2px var(--dd-chrome-background-elevated)" }}
        />
      </div>
      {open && (
        <div
          className="dd-animate-in"
          data-testid={testId ? `${testId}-popover` : undefined}
          style={{ ...panelStyle, position: "absolute", right: 0, top: "100%", marginTop: 6, zIndex: 20, padding: 10, width: 176, display: "flex", flexDirection: "column", gap: 8 }}
        >
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
            {palette.map((color) => (
              <Swatch key={color} color={color} selected={value === color} onClick={() => onChange(color)} size={22} />
            ))}
          </div>
          {shades.length > 0 && (
            <div style={{ display: "flex", gap: 5 }}>
              {shades.map((color) => (
                <Swatch key={color} color={color} selected={normalizeHex(value) === color} onClick={() => onChange(color)} size={22} />
              ))}
            </div>
          )}
          <div style={{ display: "flex", gap: 6 }}>
            <input
              data-testid={testId ? `${testId}-hex` : undefined}
              aria-label={customColorLabel}
              value={hexDraft}
              onChange={(event) => setHexDraft(event.target.value)}
              onBlur={commitHex}
              onKeyDown={(event) => {
                if (event.key === "Enter") commitHex();
              }}
              style={{ ...inputStyle, padding: "6px 8px" }}
            />
            {eyedropperSupported && (
              <button
                type="button"
                data-testid={testId ? `${testId}-eyedropper` : undefined}
                aria-label={customColorLabel}
                onClick={pickWithEyedropper}
                style={{ flexShrink: 0, width: 32, borderRadius: RADIUS.control, border: "1px solid var(--dd-chrome-border)", background: "var(--dd-chrome-background)", color: "var(--dd-text-primary)", cursor: "pointer" }}
              >
                ⚲
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
