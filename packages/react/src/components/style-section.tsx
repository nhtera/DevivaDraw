/**
 * Generic labeled button-group row — reused by the properties panel for every discrete style choice
 * (fill style, stroke width, stroke style, roughness, edges, arrowheads, text align, ...) instead of
 * a bespoke component per field.
 */
import { buttonStyle, labelStyle } from "./chrome-styles";
import { Icon } from "./icon";

export interface StyleOption<T extends string> {
  value: T;
  label: string;
  /** When set, the button shows this icon instead of the text `label`; `label` stays the tooltip + accessible name so the control is still discoverable and screen-reader-legible. */
  icon?: string;
}

export interface StyleSectionProps<T extends string> {
  label: string;
  options: readonly StyleOption<T>[];
  value: T;
  onChange(value: T): void;
  /** Prefixes each option button's `data-testid` (e.g. `"stroke-width"` -> `"stroke-width-thin"`) — omit for sections e2e never needs to target directly. */
  testIdPrefix?: string;
}

export interface OpacityRowProps {
  /** Already-translated field name; the current value is appended to it. */
  label: string;
  value: number;
  onChange(value: number): void;
}

/**
 * The 0-100 opacity slider, shared by the shape panel and the text panel — one copy so the two cannot
 * drift apart.
 *
 * `display`/`margin`/`box-sizing` are load-bearing, not cosmetic: a range input carries a UA margin on
 * each side, so a bare `width: 100%` renders it wider than its container. In a 220px panel that is
 * enough to overflow, and since a scroll container computes `overflow-x` alongside its `overflow-y`,
 * the overflow surfaces as a horizontal scrollbar under the whole panel.
 */
export function OpacityRow(props: OpacityRowProps) {
  const { label, value, onChange } = props;
  return (
    <div>
      <span style={labelStyle}>
        {label}: {value}
      </span>
      <input type="range" min={0} max={100} value={value} onChange={(event) => onChange(Number(event.target.value))} style={{ display: "block", width: "100%", boxSizing: "border-box", margin: 0 }} />
    </div>
  );
}

export function StyleSection<T extends string>(props: StyleSectionProps<T>) {
  const { label, options, value, onChange, testIdPrefix } = props;
  return (
    <div>
      <span style={labelStyle}>{label}</span>
      <div style={{ display: "flex", gap: 2 }}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            title={option.label}
            aria-label={option.label}
            aria-pressed={value === option.value}
            data-testid={testIdPrefix ? `${testIdPrefix}-${option.value}` : undefined}
            style={{ ...buttonStyle(value === option.value), flex: 1, padding: option.icon ? "5px 6px" : "4px 6px" }}
            onClick={() => onChange(option.value)}
          >
            {option.icon ? <Icon name={option.icon} size={18} /> : option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
