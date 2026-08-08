/**
 * Color picker for a single style field (stroke or background): palette swatches (the engine's own
 * default palette — `DEFAULT_STROKE_COLOR_PALETTE`/`DEFAULT_BACKGROUND_COLOR_PALETTE` — plus
 * recently-used colors from `ShapeStyleState.getRecentColors()`) and a custom-hex `<input type=color>`
 * fallback, matching the phase's "palette + custom hex + recently-used" requirement.
 */
import { labelStyle } from "./chrome-styles";

export interface ColorPickerProps {
  label: string;
  value: string;
  palette: readonly string[];
  recentColors: readonly string[];
  onChange(color: string): void;
  customColorLabel: string;
}

const SWATCH_SIZE = 20;

function Swatch(props: { color: string; selected: boolean; onClick: () => void }) {
  const { color, selected, onClick } = props;
  return (
    <button
      type="button"
      onClick={onClick}
      title={color}
      style={{
        width: SWATCH_SIZE,
        height: SWATCH_SIZE,
        borderRadius: 4,
        border: selected ? "2px solid var(--dd-accent)" : "1px solid var(--dd-chrome-border)",
        background: color === "transparent" ? "repeating-conic-gradient(#ccc 0% 25%, transparent 0% 50%) 50% / 8px 8px" : color,
        cursor: "pointer",
        padding: 0,
      }}
    />
  );
}

export function ColorPicker(props: ColorPickerProps) {
  const { label, value, palette, recentColors, onChange, customColorLabel } = props;
  const uniqueRecent = recentColors.filter((color) => !palette.includes(color)).slice(0, 8);

  return (
    <div>
      <span style={labelStyle}>{label}</span>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 4 }}>
        {palette.map((color) => (
          <Swatch key={color} color={color} selected={value === color} onClick={() => onChange(color)} />
        ))}
        {uniqueRecent.map((color) => (
          <Swatch key={color} color={color} selected={value === color} onClick={() => onChange(color)} />
        ))}
        <input
          type="color"
          aria-label={customColorLabel}
          value={value.startsWith("#") ? value : "#000000"}
          onChange={(event) => onChange(event.target.value)}
          style={{ width: SWATCH_SIZE, height: SWATCH_SIZE, padding: 0, border: "1px solid var(--dd-chrome-border)", borderRadius: 4, cursor: "pointer" }}
        />
      </div>
    </div>
  );
}
