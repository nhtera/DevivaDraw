/**
 * The library's own button, opposite the top bar.
 *
 * It lives at the right edge rather than among the undo/zoom controls because that is the edge the
 * sidebar it drives comes from: the button that summons the panel sits where the panel appears, and
 * where the pointer already is when dismissing it. It is a toggle, not an opener — the same click
 * closes what it opened, so reaching the library never depends on finding a second control.
 *
 * While the sidebar is open the button slides left by `--dd-library-sidebar-width` (the width the
 * sidebar publishes for the right-anchored chrome) so it stays beside the panel it toggles instead of
 * being covered by it.
 */
import { buttonStyle, panelStyle } from "./chrome-styles";
import { Icon } from "./icon";
import { useTranslation } from "../i18n/use-translation";

export interface LibraryToggleProps {
  open: boolean;
  onToggle(): void;
}

/** The top bar's inset, so the two line up across the top of the viewport. */
const INSET = 12;

export function LibraryToggle(props: LibraryToggleProps) {
  const { open, onToggle } = props;
  const { t } = useTranslation();

  return (
    <div style={{ ...panelStyle, display: "flex", padding: 4, position: "absolute", top: INSET, right: `calc(${INSET}px + var(--dd-library-sidebar-width, 0px))` }}>
      <button
        type="button"
        data-testid="library-toggle"
        title={t("library.title")}
        aria-label={t("library.title")}
        // Both the a11y state and what the chrome stylesheet keys the active tint on — see `buttonStyle`.
        aria-pressed={open}
        style={buttonStyle(open)}
        onClick={onToggle}
      >
        <Icon name="library" />
      </button>
    </div>
  );
}
