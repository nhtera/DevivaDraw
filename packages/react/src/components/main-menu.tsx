/**
 * Main menu: open/save/export/copy-as-image (the persistence/export layer), theme toggle (explicit
 * light/dark, not just the single-action toggle), language switcher (EN/VI), help/shortcuts dialog
 * trigger, reset canvas
 * (confirmed via `window.confirm` at this UI call site — the underlying `new-scene` action itself has
 * no confirm baked in, so a future keyboard/palette trigger of the same action stays un-prompted by
 * design; only this explicit, easy-to-mis-click menu item guards itself).
 */
import { useEffect, useLayoutEffect, useReducer, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Z_LAYER, buttonStyle, inputStyle, panelStyle } from "./chrome-styles";
import { CanvasBackgroundRow } from "./canvas-background-row";
import { isInsidePopover, popoverMarkerProps, popoverPortalHost } from "./popover-portal-host";
import { Icon } from "./icon";
import { detectIsMac, formatShortcut } from "../actions/format-shortcut";
import type { Locale } from "../i18n/locale-storage";
import { useTranslation } from "../i18n/use-translation";
import { useTheme } from "../theme/theme-provider";
import type { ThemePreference } from "../theme/theme-tokens";
import { useInputDevicePreference } from "../browser/input-device-preference";
import type { InputDevicePreference } from "../browser/input-device-preference";
import { useEditorPreferences } from "../browser/editor-preferences";
import type { SelectOnMode } from "@deviva-draw/engine";
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
/** The theme picker's three choices, each with its glyph — a light sun, a dark moon, a system monitor. */
const THEME_OPTIONS: readonly { value: ThemePreference; icon: string }[] = [
  { value: "light", icon: "theme-light" },
  { value: "dark", icon: "theme-dark" },
  { value: "system", icon: "theme-system" },
];
/** The preference-flyout toggle rows — one table, so the flyout and any future surface agree on order and state reads. */
const PREFERENCE_TOGGLES: readonly {
  actionId: string;
  testId: string;
  icon: string;
  labelKey: Parameters<ReturnType<typeof useTranslation>["t"]>[0];
  isChecked: (runtime: DevivaRuntime) => boolean;
}[] = [
  { actionId: "toggle-grid", testId: "main-menu-toggle-grid", icon: "grid", labelKey: "action.toggleGrid", isChecked: (runtime) => runtime.grid.enabled },
  { actionId: "toggle-object-snap", testId: "main-menu-toggle-object-snap", icon: "snap", labelKey: "action.toggleObjectSnap", isChecked: (runtime) => runtime.objectSnap.enabled },
  { actionId: "toggle-zen-mode", testId: "main-menu-toggle-zen-mode", icon: "zen", labelKey: "action.toggleZenMode", isChecked: (runtime) => runtime.ui.getZenMode() },
  { actionId: "toggle-view-only", testId: "main-menu-toggle-view-only", icon: "view-only", labelKey: "action.toggleViewOnly", isChecked: (runtime) => runtime.ui.getViewOnly() },
  { actionId: "toggle-layers", testId: "main-menu-toggle-layers", icon: "layers", labelKey: "action.toggleLayers", isChecked: (runtime) => runtime.ui.getLayersPanelVisible() },
  { actionId: "toggle-minimap", testId: "main-menu-toggle-minimap", icon: "minimap", labelKey: "action.toggleMinimap", isChecked: (runtime) => runtime.ui.getMinimapVisible() },
  { actionId: "toggle-stats", testId: "main-menu-toggle-stats", icon: "stats", labelKey: "action.toggleStats", isChecked: (runtime) => runtime.ui.getStatsPanelVisible() },
  { actionId: "toggle-properties-panel", testId: "main-menu-toggle-properties-panel", icon: "sliders", labelKey: "action.togglePropertiesPanel", isChecked: (runtime) => runtime.ui.getPropertiesPanelVisible() },
  { actionId: "toggle-tool-lock", testId: "main-menu-toggle-tool-lock", icon: "lock", labelKey: "action.toggleToolLock", isChecked: (runtime) => runtime.ui.getToolLocked() },
];

/** The input-device picker's three wheel-routing modes, mirroring the theme picker's icon-radio shape. */
const INPUT_DEVICE_OPTIONS: readonly { value: InputDevicePreference["mode"]; icon: string }[] = [
  { value: "auto", icon: "input-auto" },
  { value: "trackpad", icon: "input-trackpad" },
  { value: "mouse", icon: "input-mouse" },
];

/** What a marquee drag selects. Text-labeled rather than icon-only: "wrap" vs "overlap" has no glyph a user would read correctly without the word. */
const SELECT_ON_OPTIONS: readonly SelectOnMode[] = ["auto", "wrap", "overlap"];

/** Shared style for the small uppercase-ish section headers (Theme / Language). */
const sectionLabelStyle = { padding: "6px 8px 2px", fontSize: 11, color: "var(--dd-text-secondary)" } as const;

function MenuButton(props: { onClick: () => void; icon: string; children: string; testId: string; checked?: boolean; shortcutHint?: string; disabled?: boolean }) {
  // `checked` distinguishes a toggle row (zen mode, minimap, …) from a plain command row: toggles are
  // `menuitemcheckbox`es and draw a trailing ✓ when on — the row itself stays unhighlighted so the
  // eye scans one column of marks. `disabled` renders the row inert and dimmed (used for a setting
  // that only applies under another setting's value, e.g. invert-zoom outside mouse mode).
  const isToggle = props.checked !== undefined;
  return (
    <button
      type="button"
      role={isToggle ? "menuitemcheckbox" : undefined}
      aria-checked={isToggle ? props.checked : undefined}
      data-testid={props.testId}
      disabled={props.disabled}
      style={{ ...buttonStyle(false), justifyContent: "flex-start", width: "100%", ...(props.disabled ? { opacity: 0.45, cursor: "default" } : undefined) }}
      onClick={props.onClick}
    >
      <Icon name={props.icon} />
      {props.children}
      {props.shortcutHint && <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--dd-text-secondary)" }}>{props.shortcutHint}</span>}
      {props.checked && (
        <span style={{ marginLeft: props.shortcutHint ? 6 : "auto", display: "inline-flex", color: "var(--dd-accent)" }}>
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

/** Estimated flyout height used to clamp its top so it stays on-screen: one row per `PREFERENCE_TOGGLES` entry + the input-device section (label + radio row + invert & pen rows) + the select-on section (label + radio row + two toggle rows). */
const FLYOUT_HEIGHT_ESTIMATE = PREFERENCE_TOGGLES.length * 34 + 144 + 128;

export function MainMenu(props: MainMenuProps) {
  const { runtime, onClose, onOpenShortcuts, onOpenCollab, onOpenExport, onOpenLibrary, onOpenMermaid, onOpenEmbed, shareEnabled } = props;
  const { t, locale, setLocale } = useTranslation();
  const { preference, setPreference } = useTheme();
  const { preference: inputDevice, setPreference: setInputDevice } = useInputDevicePreference();
  const { preferences: editorPreferences, setPreferences: setEditorPreferences } = useEditorPreferences();
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const prefsRowRef = useRef<HTMLButtonElement | null>(null);
  // Portalled flyout position (viewport coords) — the menu is a scroll container, so an absolutely
  // positioned child would be clipped by its own parent; `null` until measured keeps the first
  // paint hidden (the color-picker popover's exact pattern).
  const [flyoutPos, setFlyoutPos] = useState<{ top: number; left: number } | null>(null);
  // Flyout toggles keep the menu open, so their check marks need a re-render trigger of their own.
  const [, bump] = useReducer((count: number) => count + 1, 0);
  const isMac = detectIsMac(typeof navigator !== "undefined" ? navigator.platform : undefined);
  const shortcutHintFor = (actionId: string): string | undefined => {
    const combo = runtime.actionRegistry.get(actionId)?.shortcut;
    return combo ? formatShortcut(combo, isMac) : undefined;
  };

  useLayoutEffect(() => {
    if (!prefsOpen) {
      setFlyoutPos(null);
      return;
    }
    const measure = () => {
      const row = prefsRowRef.current;
      if (!row) return;
      const rect = row.getBoundingClientRect();
      const top = Math.max(8, Math.min(rect.top - 4, window.innerHeight - 8 - FLYOUT_HEIGHT_ESTIMATE - 8));
      setFlyoutPos({ top, left: rect.right + 6 });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [prefsOpen]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      // A popover this menu opened (the canvas-background color picker) is portalled out of the menu,
      // so it reads as "outside" by containment alone — see `isInsidePopover`.
      if (isInsidePopover(event.target)) return;
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) onClose();
    };
    // Escape steps back one level: flyout first, then the menu — now that flyout toggles keep the
    // menu open, the keyboard needs an explicit way out.
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setPrefsOpen((open) => {
        if (open) return false;
        onClose();
        return open;
      });
    };
    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  const run = (actionId: string) => {
    runtime.actionRegistry.run(actionId, runtime);
    onClose();
  };

  return (
    <div ref={menuRef} role="menu" data-testid="main-menu" className="dd-animate-in" style={{ ...panelStyle, position: "absolute", top: 56, left: 12, padding: 4, width: 220, zIndex: Z_LAYER.menu, maxHeight: "calc(100dvh - 72px)", overflowY: "auto" }}>
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
      {/* The view/preference toggles live in a flyout submenu, keeping the main list short as
          settings accumulate. Unlike every other row, a flyout toggle does NOT close the menu —
          flipping several preferences in one visit is the whole point — so these rows re-render via
          the local `bump` instead of relying on the close-and-reopen freshness the plain rows use. */}
      <button
        ref={prefsRowRef}
        type="button"
        data-testid="main-menu-preferences"
        aria-haspopup="menu"
        aria-expanded={prefsOpen}
        style={{ ...buttonStyle(prefsOpen), justifyContent: "flex-start", width: "100%" }}
        onClick={() => setPrefsOpen((open) => !open)}
      >
        <Icon name="settings" />
        {t("menu.preferences")}
        <span style={{ marginLeft: "auto", display: "inline-flex", color: "var(--dd-text-secondary)" }}>
          <Icon name="chevron-right" size={14} />
        </span>
      </button>
      {prefsOpen &&
        createPortal(
          <div
            role="menu"
            {...popoverMarkerProps}
            data-testid="main-menu-preferences-flyout"
            className="dd-animate-in"
            style={{ ...panelStyle, position: "fixed", top: flyoutPos?.top ?? 0, left: flyoutPos?.left ?? 0, visibility: flyoutPos ? "visible" : "hidden", width: 230, padding: 4, zIndex: Z_LAYER.popover }}
          >
            {PREFERENCE_TOGGLES.map(({ actionId, testId, icon, labelKey, isChecked }) => (
              <MenuButton
                key={actionId}
                testId={testId}
                icon={icon}
                checked={isChecked(runtime)}
                shortcutHint={shortcutHintFor(actionId)}
                onClick={() => {
                  runtime.actionRegistry.run(actionId, runtime);
                  bump();
                }}
              >
                {t(labelKey)}
              </MenuButton>
            ))}
            <div style={{ height: 1, background: "var(--dd-chrome-border)", margin: "4px 0" }} />
            <div style={sectionLabelStyle}>{t("menu.inputDevice")}</div>
            <div style={{ display: "flex", gap: 2, padding: "0 4px 4px" }} role="radiogroup" aria-label={t("menu.inputDevice")}>
              {INPUT_DEVICE_OPTIONS.map(({ value, icon }) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  data-testid={`main-menu-input-device-${value}`}
                  title={t(`inputDevice.${value}`)}
                  aria-label={t(`inputDevice.${value}`)}
                  aria-checked={inputDevice.mode === value}
                  aria-pressed={inputDevice.mode === value}
                  style={{ ...buttonStyle(inputDevice.mode === value), flex: 1, justifyContent: "center", padding: "8px 0" }}
                  onClick={() => setInputDevice({ mode: value })}
                >
                  <Icon name={icon} />
                </button>
              ))}
            </div>
            <MenuButton
              testId="main-menu-invert-mouse-zoom"
              icon="input-mouse"
              checked={inputDevice.invertMouseZoom}
              disabled={inputDevice.mode !== "mouse"}
              onClick={() => setInputDevice({ invertMouseZoom: !inputDevice.invertMouseZoom })}
            >
              {t("inputDevice.invertMouseZoom")}
            </MenuButton>
            <MenuButton
              testId="main-menu-pen-only-draw"
              icon="pencil"
              checked={inputDevice.penOnlyDraw}
              onClick={() => setInputDevice({ penOnlyDraw: !inputDevice.penOnlyDraw })}
            >
              {t("inputDevice.penOnlyDraw")}
            </MenuButton>
            <div style={{ height: 1, background: "var(--dd-chrome-border)", margin: "4px 0" }} />
            <div style={sectionLabelStyle}>{t("menu.selectOn")}</div>
            <div style={{ display: "flex", gap: 2, padding: "0 4px 4px" }} role="radiogroup" aria-label={t("menu.selectOn")}>
              {SELECT_ON_OPTIONS.map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  data-testid={`main-menu-select-on-${value}`}
                  title={t(`selectOn.${value}`)}
                  aria-checked={editorPreferences.selectOnMode === value}
                  aria-pressed={editorPreferences.selectOnMode === value}
                  style={{ ...buttonStyle(editorPreferences.selectOnMode === value), flex: 1, justifyContent: "center", padding: "6px 0", fontSize: 11 }}
                  onClick={() => setEditorPreferences({ selectOnMode: value })}
                >
                  {t(`selectOn.${value}`)}
                </button>
              ))}
            </div>
            <MenuButton
              testId="main-menu-arrow-binding"
              icon="arrow"
              checked={editorPreferences.arrowBinding}
              onClick={() => setEditorPreferences({ arrowBinding: !editorPreferences.arrowBinding })}
            >
              {t("action.toggleArrowBinding")}
            </MenuButton>
            <MenuButton
              testId="main-menu-snap-midpoints"
              icon="snap"
              checked={editorPreferences.snapMidpoints}
              onClick={() => setEditorPreferences({ snapMidpoints: !editorPreferences.snapMidpoints })}
            >
              {t("action.toggleSnapMidpoints")}
            </MenuButton>
          </div>,
          popoverPortalHost(prefsRowRef.current),
        )}
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
