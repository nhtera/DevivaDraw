/**
 * Main menu: open/save/export/copy-as-image (the persistence/export layer), theme toggle (explicit
 * light/dark, not just the single-action toggle), language switcher (EN/VI), help/shortcuts dialog
 * trigger, reset canvas
 * (confirmed via `window.confirm` at this UI call site — the underlying `new-scene` action itself has
 * no confirm baked in, so a future keyboard/palette trigger of the same action stays un-prompted by
 * design; only this explicit, easy-to-mis-click menu item guards itself).
 */
import { useEffect, useRef } from "react";
import { buttonStyle, panelStyle } from "./chrome-styles";
import { Icon } from "./icon";
import type { Locale } from "../i18n/locale-storage";
import { useTranslation } from "../i18n/use-translation";
import { useTheme } from "../theme/theme-provider";
import type { DevivaRuntime } from "../runtime/runtime-types";

export interface MainMenuProps {
  runtime: DevivaRuntime;
  onClose(): void;
  onOpenShortcuts(): void;
  onOpenCollab(): void;
  /** Whether the host configured `shareApiBaseUrl` — gates both "Share" and "Collaborate…", which both depend on the same collab-server endpoint (see `deviva-draw-app-types.ts`'s `shareApiBaseUrl` doc). `false` hides them entirely rather than showing a menu entry that would just fail every time. */
  shareEnabled: boolean;
}

const LOCALES: Locale[] = ["en", "vi"];

function MenuButton(props: { onClick: () => void; icon: string; children: string; testId: string }) {
  return (
    <button type="button" data-testid={props.testId} style={{ ...buttonStyle(false), justifyContent: "flex-start", width: "100%" }} onClick={props.onClick}>
      <Icon name={props.icon} />
      {props.children}
    </button>
  );
}

export function MainMenu(props: MainMenuProps) {
  const { runtime, onClose, onOpenShortcuts, onOpenCollab, shareEnabled } = props;
  const { t, locale, setLocale } = useTranslation();
  const { mode, setMode } = useTheme();
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
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
    <div ref={menuRef} role="menu" data-testid="main-menu" className="dd-animate-in" style={{ ...panelStyle, position: "absolute", top: 56, left: 12, padding: 4, width: 220, zIndex: 90 }}>
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
      <div style={{ padding: "4px 8px", fontSize: 11, color: "var(--dd-text-secondary)" }}>{t("menu.theme")}</div>
      <div style={{ display: "flex", gap: 2, padding: "0 4px 4px" }}>
        {(["light", "dark"] as const).map((option) => (
          <button key={option} type="button" data-testid={`main-menu-theme-${option}`} aria-pressed={mode === option} style={{ ...buttonStyle(mode === option), flex: 1 }} onClick={() => setMode(option)}>
            {t(`theme.${option}`)}
          </button>
        ))}
      </div>
      <div style={{ padding: "4px 8px", fontSize: 11, color: "var(--dd-text-secondary)" }}>{t("menu.language")}</div>
      <div style={{ display: "flex", gap: 2, padding: "0 4px 4px" }}>
        {LOCALES.map((option) => (
          <button key={option} type="button" data-testid={`main-menu-locale-${option}`} aria-pressed={locale === option} style={{ ...buttonStyle(locale === option), flex: 1 }} onClick={() => setLocale(option)}>
            {t(`language.${option}`)}
          </button>
        ))}
      </div>
      <div style={{ height: 1, background: "var(--dd-chrome-border)", margin: "4px 0" }} />
      <MenuButton testId="main-menu-toggle-zen-mode" icon="zen" onClick={() => run("toggle-zen-mode")}>
        {t("action.toggleZenMode")}
      </MenuButton>
      <MenuButton testId="main-menu-toggle-view-only" icon="view-only" onClick={() => run("toggle-view-only")}>
        {t("action.toggleViewOnly")}
      </MenuButton>
      <MenuButton testId="main-menu-toggle-stats" icon="stats" onClick={() => run("toggle-stats")}>
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
