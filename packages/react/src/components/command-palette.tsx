/**
 * `Ctrl/Cmd+K` command palette: fuzzy-searchable `ActionRegistry` list (`actions/fuzzy-match.ts`),
 * arrow-key navigable, `Enter` runs the highlighted action, `Escape` closes — the fourth (and last)
 * surface reading from the single shared `ActionRegistry` alongside the toolbar/panel/shortcuts.
 *
 * Keydown leak defense-in-depth: the primary fix is `use-deviva-runtime.ts`'s
 * `isChromeOverlayOpen`-gated suppression (the global shortcut resolver never even looks at a key
 * while this palette is open), but `handleKeyDown` also calls `stopPropagation` so a letter typed
 * here can never bubble to `window` and reach that resolver even if the suppression flag were
 * somehow wrong — belt-and-suspenders, not the primary mechanism.
 */
import { useMemo, useState } from "react";
import type { KeyboardEvent } from "react";
import { dialogOverlayStyle, dialogStyle, disabledButtonStyle, inputStyle } from "./chrome-styles";
import { Icon } from "./icon";
import { fuzzyMatch } from "../actions/fuzzy-match";
import { useTranslation } from "../i18n/use-translation";
import type { DevivaRuntime } from "../runtime/runtime-types";

export interface CommandPaletteProps {
  runtime: DevivaRuntime;
  onClose(): void;
}

export function CommandPalette(props: CommandPaletteProps) {
  const { runtime, onClose } = props;
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const results = useMemo(
    () => runtime.actionRegistry.list().map((action) => ({ action, label: t(action.labelKey) })).filter(({ label }) => fuzzyMatch(query, label)),
    [runtime, t, query],
  );

  const runAt = (index: number) => {
    const entry = results[index];
    if (!entry) return;
    runtime.actionRegistry.run(entry.action.id, runtime);
    onClose();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // Defense in depth (see module doc) — never let a keystroke typed into this input bubble past
    // the dialog to `window`'s global shortcut listener.
    event.stopPropagation();
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, results.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      runAt(activeIndex);
    } else if (event.key === "Escape") {
      onClose();
    }
  };

  return (
    <div style={dialogOverlayStyle} onClick={onClose} data-testid="command-palette-overlay">
      <div style={dialogStyle} onClick={(event) => event.stopPropagation()} role="dialog" data-testid="command-palette">
        <input
          type="text"
          autoFocus
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
          }}
          onKeyDown={handleKeyDown}
          placeholder={t("commandPalette.placeholder")}
          style={inputStyle}
          data-testid="command-palette-search"
        />
        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 2, maxHeight: 320, overflow: "auto" }} role="listbox">
          {results.length === 0 && <span style={{ color: "var(--dd-text-secondary)" }}>{t("commandPalette.noResults")}</span>}
          {results.map(({ action, label }, index) => {
            const enabled = runtime.actionRegistry.isEnabled(action.id, runtime);
            return (
              <button
                key={action.id}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                data-testid={`command-palette-item-${action.id}`}
                disabled={!enabled}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 8px",
                  border: "none",
                  borderRadius: 6,
                  cursor: "pointer",
                  textAlign: "left",
                  background: index === activeIndex ? "var(--dd-accent)" : "transparent",
                  color: index === activeIndex ? "var(--dd-accent-contrast)" : "var(--dd-text-primary)",
                  ...(enabled ? {} : disabledButtonStyle),
                }}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => runAt(index)}
              >
                <Icon name={action.icon} />
                {label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
