/**
 * "Scroll back to content": a floating pill shown only when the scene has elements but none of them
 * are on screen — the affordance that stops an infinite canvas from losing the user, and the one thing
 * Excalidraw does here that Deviva had no equivalent for (zoom-to-fit existed, but only as `Shift+1`
 * and a menu row, neither of which a lost user thinks to look for).
 *
 * The predicate reuses the renderer's own culling (`filterVisibleElements`), so "on screen" means
 * exactly what the draw pass means by it — no second, drifting definition of visibility.
 */
import { filterVisibleElements } from "@deviva-draw/engine";
import { useEffect, useState } from "react";
import { buttonStyle, panelStyle } from "./chrome-styles";
import { Icon } from "./icon";
import { useTranslation } from "../i18n/use-translation";
import { useSceneVersion } from "../runtime/use-live-version";
import { useStableCallback } from "../runtime/use-stable-ref";
import type { CameraStore } from "../runtime/camera-store";
import type { DevivaRuntime } from "../runtime/runtime-types";

export interface BackToContentPillProps {
  runtime: DevivaRuntime;
  cameraStore: CameraStore;
  getViewportSize(): { width: number; height: number };
}

export function BackToContentPill(props: BackToContentPillProps) {
  const { runtime, cameraStore } = props;
  // Stable identity: the shell passes a fresh arrow function each render (see `minimap.tsx`).
  const getViewportSize = useStableCallback(props.getViewportSize);
  const { t } = useTranslation();
  const sceneVersion = useSceneVersion(runtime.scene);
  const [lost, setLost] = useState(false);

  useEffect(() => {
    const check = () => {
      const viewport = getViewportSize();
      // A zero-sized viewport means the host hasn't laid out yet — treat it as "not lost" rather than
      // flashing the pill on first paint, when nothing can be visible by definition.
      if (viewport.width === 0 || viewport.height === 0) return setLost(false);
      const elements = runtime.scene.getElements().filter((element) => !element.isDeleted);
      if (elements.length === 0) return setLost(false);
      setLost(filterVisibleElements(elements, cameraStore.getCamera(), viewport).length === 0);
    };
    check();
    return cameraStore.subscribe(check);
  }, [runtime.scene, cameraStore, getViewportSize, sceneVersion]);

  if (!lost) return null;

  return (
    <div style={{ position: "absolute", top: 96, left: "50%", transform: "translateX(-50%)", zIndex: 35 }}>
      <button
        type="button"
        data-testid="back-to-content"
        className="dd-animate-in"
        title={t("action.backToContent")}
        aria-label={t("action.backToContent")}
        style={{ ...panelStyle, ...buttonStyle(false), display: "flex", alignItems: "center", gap: 6, width: "auto", height: "auto", padding: "8px 14px" }}
        onClick={() => runtime.actionRegistry.run("zoom-to-fit", runtime)}
      >
        <Icon name="zoom-fit" />
        <span>{t("action.backToContent")}</span>
      </button>
    </div>
  );
}
