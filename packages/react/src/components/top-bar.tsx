/**
 * Top bar: undo/redo, zoom controls (in/out/percentage readout/fit), and the main-menu trigger.
 * Undo/redo enabled-state and the zoom percentage both read live engine state reactively —
 * `useSceneVersion` for history availability (every undo-relevant mutation notifies the scene, see
 * `use-live-version.ts`'s doc) and `useCameraVersion` for the zoom readout (the camera-change
 * subscription from `camera-store.ts`, not a poll).
 */
import { buttonStyle, disabledButtonStyle, panelStyle } from "./chrome-styles";
import { Icon } from "./icon";
import { useTranslation } from "../i18n/use-translation";
import { ZoomMenu } from "./zoom-menu";
import { useCameraVersion, useSceneVersion } from "../runtime/use-live-version";
import type { CameraStore } from "../runtime/camera-store";
import type { DevivaRuntime } from "../runtime/runtime-types";

export interface TopBarProps {
  runtime: DevivaRuntime;
  cameraStore: CameraStore;
  onOpenMainMenu(): void;
  /**
   * Tablet-tier arrangement: the bar shrinks to just the menu trigger, so the centered toolbar has
   * the whole top row (the genre convention — a lone hamburger top-left, with history/zoom moved to
   * a bottom-left island; render `<TabletBottomControls/>` alongside). Default full bar.
   */
  compact?: boolean;
}

/** Gap between the bar and the top/left viewport edges. */
const INSET = 12;

/**
 * How far down the viewport the bar reaches — one row of icon buttons plus its own padding and border.
 * The properties panel is anchored under it on the same edge and clears this; owned here so the bar's
 * geometry stays described in one file. `panel-layout.spec.ts` asserts the two don't actually overlap,
 * which is what catches this drifting out of date.
 */
export const TOP_BAR_BOTTOM = INSET + 38;

function ActionIconButton(props: { runtime: DevivaRuntime; actionId: string; label: string }) {
  const { runtime, actionId, label } = props;
  const enabled = runtime.actionRegistry.isEnabled(actionId, runtime);
  return (
    <button
      type="button"
      data-testid={`top-bar-${actionId}`}
      // Both attributes, always: `aria-label` names the icon-only button for assistive tech, `title`
      // is what actually produces the hover tooltip. Carrying only one (as these buttons used to)
      // leaves the control either silent to a screen reader or silent on hover.
      title={label}
      aria-label={label}
      disabled={!enabled}
      style={{ ...buttonStyle(false), ...(enabled ? {} : disabledButtonStyle) }}
      onClick={() => runtime.actionRegistry.run(actionId, runtime)}
    >
      <Icon name={runtime.actionRegistry.get(actionId)?.icon ?? "?"} />
    </button>
  );
}

/** Undo/redo + zoom controls — shared verbatim between the full top bar and the tablet bottom island, so both surfaces (and their testids) stay identical. */
function HistoryZoomControls(props: { runtime: DevivaRuntime; cameraStore: CameraStore; zoomMenuPlacement?: "down" | "up" }) {
  const { runtime, cameraStore, zoomMenuPlacement } = props;
  const { t } = useTranslation();
  useSceneVersion(runtime.scene);
  useCameraVersion(cameraStore);
  return (
    <>
      <ActionIconButton runtime={runtime} actionId="undo" label={t("action.undo")} />
      <ActionIconButton runtime={runtime} actionId="redo" label={t("action.redo")} />
      <div style={{ width: 1, height: 20, background: "var(--dd-chrome-border)", margin: "0 4px" }} />
      <ActionIconButton runtime={runtime} actionId="zoom-out" label={t("action.zoomOut")} />
      <ZoomMenu runtime={runtime} cameraStore={cameraStore} placement={zoomMenuPlacement} />
      <ActionIconButton runtime={runtime} actionId="zoom-in" label={t("action.zoomIn")} />
    </>
  );
}

export function TopBar(props: TopBarProps) {
  const { runtime, cameraStore, onOpenMainMenu, compact } = props;
  const { t } = useTranslation();

  return (
    <div data-testid="top-bar" style={{ ...panelStyle, display: "flex", alignItems: "center", gap: 2, padding: 4, position: "absolute", top: `calc(${INSET}px + env(safe-area-inset-top))`, left: INSET }}>
      <button type="button" data-testid="top-bar-menu" title={t("menu.title")} aria-label={t("menu.title")} style={buttonStyle(false)} onClick={onOpenMainMenu}>
        <Icon name="menu" />
      </button>
      {!compact && (
        <>
          <div style={{ width: 1, height: 20, background: "var(--dd-chrome-border)", margin: "0 4px" }} />
          <HistoryZoomControls runtime={runtime} cameraStore={cameraStore} />
        </>
      )}
    </div>
  );
}

/**
 * The tablet tier's bottom-left island: the history/zoom controls the compact top bar dropped,
 * stacked above the pages pill. The zoom popover opens upward from here.
 */
export function TabletBottomControls(props: { runtime: DevivaRuntime; cameraStore: CameraStore }) {
  return (
    <div
      data-testid="tablet-bottom-controls"
      style={{ ...panelStyle, display: "flex", alignItems: "center", gap: 2, padding: 4, position: "absolute", bottom: `calc(60px + env(safe-area-inset-bottom))`, left: INSET, zIndex: 20 }}
    >
      <HistoryZoomControls runtime={props.runtime} cameraStore={props.cameraStore} zoomMenuPlacement="up" />
    </div>
  );
}
