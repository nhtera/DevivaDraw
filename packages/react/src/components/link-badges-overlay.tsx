/**
 * Clickable 🔗 badges over every element carrying a hyperlink — without these, a link set through the
 * properties panel was invisible on the canvas and only openable by re-selecting the element and
 * finding the panel row. Each badge is a real `<a>` (new tab, middle-click, copy-link all work),
 * pinned just past the element's rotated top-right corner and re-positioned on every scene/camera
 * change through the same subscription pattern the minimap draws with.
 *
 * Rendered as a SIBLING of the canvas host, not inside it — the engine's pointer pipeline listens on
 * the host, so a badge click here can never also start a marquee or change the selection underneath.
 */
import { rotatedCorners, sceneToScreen } from "@deviva-draw/engine";
import type { AnyElement, Scene } from "@deviva-draw/engine";
import { useEffect, useReducer } from "react";
import { Icon } from "./icon";
import { useSceneVersion } from "../runtime/use-live-version";
import type { CameraStore } from "../runtime/camera-store";

const BADGE_SIZE = 18;
/** Screen-space gap between the corner and the badge, camera-independent so it never crowds the shape at low zoom. */
const BADGE_OFFSET_PX = 4;

export interface LinkBadgesOverlayProps {
  scene: Scene;
  cameraStore: CameraStore;
}

export function LinkBadgesOverlay(props: LinkBadgesOverlayProps) {
  const { scene, cameraStore } = props;
  useSceneVersion(scene); // reposition/add/remove badges on element edits
  const [, bump] = useReducer((count: number) => count + 1, 0);
  useEffect(() => cameraStore.subscribe(() => bump()), [cameraStore]);

  const camera = cameraStore.getCamera();
  const linked = scene.getElements().filter((element): element is AnyElement & { link: string } => !element.isDeleted && typeof element.link === "string" && element.link !== "");
  if (linked.length === 0) return null;

  return (
    <>
      {linked.map((element) => {
        const topRight = rotatedCorners(element)[1]!;
        const screen = sceneToScreen(topRight, camera);
        return (
          <a
            key={element.id}
            href={element.link}
            target="_blank"
            rel="noreferrer"
            data-testid={`link-badge-${element.id}`}
            title={element.link}
            style={{
              position: "absolute",
              left: screen.x + BADGE_OFFSET_PX,
              top: screen.y - BADGE_SIZE - BADGE_OFFSET_PX,
              width: BADGE_SIZE,
              height: BADGE_SIZE,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 5,
              background: "var(--dd-chrome-background-elevated)",
              border: "1px solid var(--dd-chrome-border)",
              color: "var(--dd-accent)",
              // Above the canvas, below panels/menus — a badge must never cover an open popover.
              zIndex: 5,
            }}
          >
            <Icon name="link" size={11} />
          </a>
        );
      })}
    </>
  );
}
