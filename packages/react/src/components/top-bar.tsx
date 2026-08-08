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
import { useCameraVersion, useSceneVersion } from "../runtime/use-live-version";
import type { CameraStore } from "../runtime/camera-store";
import type { DevivaRuntime } from "../runtime/runtime-types";

export interface TopBarProps {
  runtime: DevivaRuntime;
  cameraStore: CameraStore;
  onOpenMainMenu(): void;
}

function ActionIconButton(props: { runtime: DevivaRuntime; actionId: string; label: string }) {
  const { runtime, actionId, label } = props;
  const enabled = runtime.actionRegistry.isEnabled(actionId, runtime);
  return (
    <button
      type="button"
      data-testid={`top-bar-${actionId}`}
      aria-label={label}
      disabled={!enabled}
      style={{ ...buttonStyle(false), ...(enabled ? {} : disabledButtonStyle) }}
      onClick={() => runtime.actionRegistry.run(actionId, runtime)}
    >
      <Icon name={runtime.actionRegistry.get(actionId)?.icon ?? "?"} />
    </button>
  );
}

export function TopBar(props: TopBarProps) {
  const { runtime, cameraStore, onOpenMainMenu } = props;
  const { t } = useTranslation();
  useSceneVersion(runtime.scene);
  useCameraVersion(cameraStore);
  const zoomPercent = Math.round(cameraStore.getCamera().zoom * 100);

  return (
    <div style={{ ...panelStyle, display: "flex", alignItems: "center", gap: 2, padding: 4, position: "absolute", top: 12, left: 12 }}>
      <button type="button" data-testid="top-bar-menu" aria-label={t("menu.title")} style={buttonStyle(false)} onClick={onOpenMainMenu}>
        <Icon name="menu" />
      </button>
      <div style={{ width: 1, height: 20, background: "var(--dd-chrome-border)", margin: "0 4px" }} />
      <ActionIconButton runtime={runtime} actionId="undo" label={t("action.undo")} />
      <ActionIconButton runtime={runtime} actionId="redo" label={t("action.redo")} />
      <div style={{ width: 1, height: 20, background: "var(--dd-chrome-border)", margin: "0 4px" }} />
      <ActionIconButton runtime={runtime} actionId="zoom-out" label={t("action.zoomOut")} />
      <button
        type="button"
        data-testid="top-bar-zoom-percentage"
        style={{ ...buttonStyle(false), minWidth: 44 }}
        title={t("action.zoomToFit")}
        onClick={() => runtime.actionRegistry.run("zoom-to-fit", runtime)}
      >
        {t("topbar.zoomPercentage", { percent: zoomPercent })}
      </button>
      <ActionIconButton runtime={runtime} actionId="zoom-in" label={t("action.zoomIn")} />
    </div>
  );
}
