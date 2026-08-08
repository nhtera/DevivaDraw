/**
 * Keyboard-shortcuts reference dialog: every `ActionRegistry` action that declares a `shortcut`,
 * searchable by label. This makes the full, manually-verified keyboard shortcut map discoverable
 * in the UI, not just a developer-facing checklist.
 *
 * Keydown leak defense-in-depth: same two-layer fix as `command-palette.tsx` — the primary mechanism
 * is `use-deviva-runtime.ts`'s `isChromeOverlayOpen` suppression of the global shortcut resolver
 * while this dialog is open; the search input's own `onKeyDown` additionally `stopPropagation`s (so a
 * letter typed here can never bubble to `window`) and handles `Escape` itself (this dialog has no
 * other keyboard-close path — closing was previously click-outside/the header button only).
 */
import { useState } from "react";
import type { KeyboardEvent } from "react";
import { dialogOverlayStyle, dialogStyle, inputStyle } from "./chrome-styles";
import { Icon } from "./icon";
import { detectIsMac, formatShortcut } from "../actions/format-shortcut";
import { useTranslation } from "../i18n/use-translation";
import type { DevivaRuntime } from "../runtime/runtime-types";

export interface ShortcutsDialogProps {
  runtime: DevivaRuntime;
  onClose(): void;
}

export function ShortcutsDialog(props: ShortcutsDialogProps) {
  const { runtime, onClose } = props;
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const isMac = detectIsMac(typeof navigator !== "undefined" ? navigator.platform : undefined);

  const entries = runtime.actionRegistry
    .list()
    .filter((action) => action.shortcut)
    .map((action) => ({ action, label: t(action.labelKey) }))
    .filter(({ label }) => label.toLowerCase().includes(query.toLowerCase()));

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation();
    if (event.key === "Escape") onClose();
  };

  return (
    <div style={dialogOverlayStyle} onClick={onClose} data-testid="shortcuts-dialog-overlay">
      <div style={dialogStyle} onClick={(event) => event.stopPropagation()} role="dialog" aria-label={t("shortcuts.title")} data-testid="shortcuts-dialog">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <strong>{t("shortcuts.title")}</strong>
          <button type="button" aria-label={t("shortcuts.close")} onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer" }}>
            <Icon name="close" />
          </button>
        </div>
        <input
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t("shortcuts.search")}
          style={inputStyle}
          data-testid="shortcuts-dialog-search"
          autoFocus
        />
        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 4 }}>
          {entries.length === 0 && <span style={{ color: "var(--dd-text-secondary)" }}>{t("shortcuts.noResults")}</span>}
          {entries.map(({ action, label }) => (
            <div key={action.id} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid var(--dd-chrome-border)" }}>
              <span>{label}</span>
              <code>{formatShortcut(action.shortcut!, isMac)}</code>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
