/**
 * Generic labeled button-group row — reused by the properties panel for every discrete style choice
 * (fill style, stroke width, stroke style, roughness, edges, arrowheads, text align, ...) instead of
 * a bespoke component per field.
 */
import { buttonStyle, labelStyle } from "./chrome-styles";

export interface StyleOption<T extends string> {
  value: T;
  label: string;
}

export interface StyleSectionProps<T extends string> {
  label: string;
  options: readonly StyleOption<T>[];
  value: T;
  onChange(value: T): void;
  /** Prefixes each option button's `data-testid` (e.g. `"stroke-width"` -> `"stroke-width-thin"`) — omit for sections e2e never needs to target directly. */
  testIdPrefix?: string;
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
            aria-pressed={value === option.value}
            data-testid={testIdPrefix ? `${testIdPrefix}-${option.value}` : undefined}
            style={{ ...buttonStyle(value === option.value), flex: 1, padding: "4px 6px" }}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
