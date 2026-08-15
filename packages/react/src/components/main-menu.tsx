/**
 * Main menu: open/save/export/copy-as-image (the persistence/export layer), theme toggle (explicit
 * light/dark, not just the single-action toggle), language switcher (EN/VI), help/shortcuts dialog
 * trigger, reset canvas
 * (confirmed via `window.confirm` at this UI call site — the underlying `new-scene` action itself has
 * no confirm baked in, so a future keyboard/palette trigger of the same action stays un-prompted by
 * design; only this explicit, easy-to-mis-click menu item guards itself).
 */
import { useEffect, useRef } from "react";
import { Z_LAYER, buttonStyle, inputStyle, panelStyle } from "./chrome-styles";
import { CanvasBackgroundRow } from "./canvas-background-row";
import { isInsidePopover } from "./popover-portal-host";
import { Icon } from "./icon";
import type { Locale } from "../i18n/locale-storage";
import { useTranslation } from "../i18n/use-translation";
import { useTheme } from "../theme/theme-provider";
import type { ThemePreference } from "../theme/theme-tokens";
import type { DevivaRuntime } from "../runtime/runtime-types";

export interface MainMenuProps {
  runtime: DevivaRuntime;
  onClose(): void;
  onOpenShortcuts(): void;
  onOpenCollab(): void;
  onOpenExport(): void;
  onOpenLibrary(): void;
  onOpenMermaid(): void;
  onOpenEmbed(): void;
  /** Whether the host configured `shareApiBaseUrl` — gates both "Share" and "Collaborate…", which both depend on the same collab-server endpoint (see `deviva-draw-app-types.ts`'s `shareApiBaseUrl` doc). `false` hides them entirely rather than showing a menu entry that would just fail every time. */
  shareEnabled: boolean;
}

const LOCALES: Locale[] = ["en", "vi"];
/** External links surfaced in the menu — the source repo and the parent product this canvas ships inside. */
const GITHUB_URL = "https://github.com/nhtera/DevivaDraw";
const DEVIVA_URL = "https://deviva.app";
/** The theme picker's three choices, each with its glyph — a light sun, a dark moon, a system monitor (matching Excalidraw's icon toggle). */
const THEME_OPTIONS: readonly { value: ThemePreference; icon: string }[] = [
  { value: "light", icon: "theme-light" },
  { value: "dark", icon: "theme-dark" },
  { value: "system", icon: "theme-system" },
];
/** Shared style for the small uppercase-ish section headers (Theme / Language). */
const sectionLabelStyle = { padding: "6px 8px 2px", fontSize: 11, color: "var(--dd-text-secondary)" } as const;

function MenuButton(props: { onClick: () => void; icon: string; children: string; testId: string; checked?: boolean }) {
  // `checked` distinguishes a toggle row (zen mode, minimap, …) from a plain command row: toggles are
  // `menuitemcheckbox`es and draw a trailing ✓ when on — the row itself stays unhighlighted so the
  // eye scans one column of marks, the way Excalidraw's preferences submenu shows active toggles.
  const isToggle = props.checked !== undefined;
  return (
    <button
      type="button"
      role={isToggle ? "menuitemcheckbox" : undefined}
      aria-checked={isToggle ? props.checked : undefined}
      data-testid={props.testId}
      style={{ ...buttonStyle(false), justifyContent: "flex-start", width: "100%" }}
      onClick={props.onClick}
    >
      <Icon name={props.icon} />
      {props.children}
      {props.checked && (
        <span style={{ marginLeft: "auto", display: "inline-flex", color: "var(--dd-accent)" }}>
          <Icon name="check" size={14} />
        </span>
      )}
    </button>
  );
}

/** A menu row that opens an external URL in a new tab — a real `<a>` (middle-click / copy-link work) styled to match `MenuButton`. */
function MenuLink(props: { href: string; icon: string; children: string; testId: string }) {
  return (
    <a
      className="dd-menu-link"
      href={props.href}
      target="_blank"
      rel="noreferrer noopener"
      data-testid={props.testId}
      style={{ ...buttonStyle(false), justifyContent: "flex-start", width: "100%", boxSizing: "border-box", textDecoration: "none" }}
    >
      <Icon name={props.icon} />
      {props.children}
    </a>
  );
}

export function MainMenu(props: MainMenuProps) {
  const { runtime, onClose, onOpenShortcuts, onOpenCollab, onOpenExport, onOpenLibrary, onOpenMermaid, onOpenEmbed, shareEnabled } = props;
  const { t, locale, setLocale } = useTranslation();
  const { preference, setPreference } = useTheme();
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      // A popover this menu opened (the canvas-background color picker) is portalled out of the menu,
      // so it reads as "outside" by containment alone — see `isInsidePopover`.
      if (isInsidePopover(event.target)) return;
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) onClose();
    };
    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [onClose]);

  const run = (actionId: string) => {
    runtime.actionRegistry.run(actionId, runtime);
    onClose();
  };

  return (
    <div ref={menuRef} role="menu" data-testid="main-menu" className="dd-animate-in" style={{ ...panelStyle, position: "absolute", top: 56, left: 12, padding: 4, width: 220, zIndex: Z_LAYER.menu, maxHeight: "calc(100vh - 72px)", overflowY: "auto" }}>
      <MenuButton testId="main-menu-open" icon="folder-open" onClick={() => run("open-scene")}>
        {t("action.openScene")}
      </MenuButton>
      <MenuButton testId="main-menu-save" icon="save" onClick={() => run("save-scene")}>
        {t("action.saveScene")}
      </MenuButton>
      <MenuButton testId="main-menu-export-png" icon="export-png" onClick={() => run("export-png")}>
        {t("action.exportPng")}
      </MenuButton>
      <MenuButton testId="main-menu-export-svg" icon="export-svg" onClick={() => run("export-svg")}>
        {t("action.exportSvg")}
      </MenuButton>
      <MenuButton
        testId="main-menu-export-image"
        icon="export-png"
        onClick={() => {
          onOpenExport();
          onClose();
        }}
      >
        {t("action.exportImage")}
      </MenuButton>
      <MenuButton
        testId="main-menu-library"
        icon="library"
        onClick={() => {
          onOpenLibrary();
          onClose();
        }}
      >
        {t("menu.library")}
      </MenuButton>
      <MenuButton
        testId="main-menu-mermaid"
        icon="shapes"
        onClick={() => {
          onOpenMermaid();
          onClose();
        }}
      >
        {t("menu.mermaid")}
      </MenuButton>
      <MenuButton
        testId="main-menu-embed"
        icon="external-link"
        onClick={() => {
          onOpenEmbed();
          onClose();
        }}
      >
        {t("menu.embed")}
      </MenuButton>
      <MenuButton testId="main-menu-copy-image" icon="copy-image" onClick={() => run("copy-as-image")}>
        {t("action.copyAsImage")}
      </MenuButton>
      {shareEnabled && (
        <MenuButton testId="main-menu-share" icon="share" onClick={() => run("share-scene")}>
          {t("action.share")}
        </MenuButton>
      )}
      {shareEnabled && (
        <MenuButton
          testId="main-menu-collab"
          icon="users"
          onClick={() => {
            onOpenCollab();
            onClose();
          }}
        >
          {t("action.collab")}
        </MenuButton>
      )}
      <div style={{ height: 1, background: "var(--dd-chrome-border)", margin: "4px 0" }} />
      <MenuLink testId="main-menu-deviva" icon="external-link" href={DEVIVA_URL}>
        {t("menu.deviva")}
      </MenuLink>
      <MenuLink testId="main-menu-github" icon="github" href={GITHUB_URL}>
        {t("menu.github")}
      </MenuLink>
      <div style={{ height: 1, background: "var(--dd-chrome-border)", margin: "4px 0" }} />
      <div style={sectionLabelStyle}>{t("menu.theme")}</div>
      <div style={{ display: "flex", gap: 2, padding: "0 4px 4px" }} role="radiogroup" aria-label={t("menu.theme")}>
        {THEME_OPTIONS.map(({ value, icon }) => (
          <button
            key={value}
            type="button"
            role="radio"
            data-testid={`main-menu-theme-${value}`}
            title={t(`theme.${value}`)}
            aria-label={t(`theme.${value}`)}
            aria-checked={preference === value}
            aria-pressed={preference === value}
            style={{ ...buttonStyle(preference === value), flex: 1, justifyContent: "center", padding: "8px 0" }}
            onClick={() => setPreference(value)}
          >
            <Icon name={icon} />
          </button>
        ))}
      </div>
      <div style={sectionLabelStyle}>{t("menu.language")}</div>
      <div style={{ padding: "0 4px 6px" }}>
        <div style={{ position: "relative", display: "flex" }}>
          <select
            data-testid="main-menu-locale"
            aria-label={t("menu.language")}
            value={locale}
            onChange={(event) => setLocale(event.target.value as Locale)}
            // Hide the browser's default dropdown arrow so the custom chevron below is the only indicator.
            style={{ ...inputStyle, appearance: "none", WebkitAppearance: "none", paddingRight: 30, cursor: "pointer" }}
          >
            {LOCALES.map((option) => (
              <option key={option} value={option}>
                {t(`language.${option}`)}
              </option>
            ))}
          </select>
          <span style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none", display: "inline-flex", color: "var(--dd-text-secondary)" }}>
            <Icon name="chevron-down" size={14} />
          </span>
        </div>
      </div>
      <div style={{ padding: "0 4px 6px" }}>
        <CanvasBackgroundRow scene={runtime.scene} />
      </div>
      <div style={{ height: 1, background: "var(--dd-chrome-border)", margin: "4px 0" }} />
      {/* Toggle rows read their state directly at render: the menu closes on every click (`run` calls
          `onClose`), so it reopens with fresh state and never needs a live subscription while open. */}
      <MenuButton testId="main-menu-toggle-grid" icon="grid" checked={runtime.grid.enabled} onClick={() => run("toggle-grid")}>
        {t("action.toggleGrid")}
      </MenuButton>
      <MenuButton testId="main-menu-toggle-object-snap" icon="snap" checked={runtime.objectSnap.enabled} onClick={() => run("toggle-object-snap")}>
        {t("action.toggleObjectSnap")}
      </MenuButton>
      <MenuButton testId="main-menu-toggle-zen-mode" icon="zen" checked={runtime.ui.getZenMode()} onClick={() => run("toggle-zen-mode")}>
        {t("action.toggleZenMode")}
      </MenuButton>
      <MenuButton testId="main-menu-toggle-view-only" icon="view-only" checked={runtime.ui.getViewOnly()} onClick={() => run("toggle-view-only")}>
        {t("action.toggleViewOnly")}
      </MenuButton>
      <MenuButton testId="main-menu-toggle-layers" icon="layers" checked={runtime.ui.getLayersPanelVisible()} onClick={() => run("toggle-layers")}>
        {t("action.toggleLayers")}
      </MenuButton>
      <MenuButton testId="main-menu-toggle-minimap" icon="minimap" checked={runtime.ui.getMinimapVisible()} onClick={() => run("toggle-minimap")}>
        {t("action.toggleMinimap")}
      </MenuButton>
      <MenuButton testId="main-menu-toggle-stats" icon="stats" checked={runtime.ui.getStatsPanelVisible()} onClick={() => run("toggle-stats")}>
        {t("action.toggleStats")}
      </MenuButton>
      <div style={{ height: 1, background: "var(--dd-chrome-border)", margin: "4px 0" }} />
      <MenuButton
        testId="main-menu-shortcuts"
        icon="command"
        onClick={() => {
          onOpenShortcuts();
          onClose();
        }}
      >
        {t("menu.help")}
      </MenuButton>
      <MenuButton
        testId="main-menu-reset"
        icon="trash"
        onClick={() => {
          if (window.confirm(t("menu.resetConfirm"))) run("new-scene");
          else onClose();
        }}
      >
        {t("menu.reset")}
      </MenuButton>
    </div>
  );
}
