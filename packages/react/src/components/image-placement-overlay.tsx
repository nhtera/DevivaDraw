/**
 * The half-transparent ghost of a picked-but-not-yet-dropped image, riding along under the cursor at
 * exactly the size the drop will produce (fitted scene size × current zoom) — so placing an image is
 * point-and-click, previewed, instead of it appearing at some spot the user then has to drag from.
 * Purely visual: `pointerEvents: none` throughout; the actual drop click is handled by
 * `use-image-file-picker.ts`'s capture-phase listener.
 */
import { useEffect, useState } from "react";
import type { Camera } from "@deviva-draw/engine";
import type { PendingImagePlacement } from "../hooks/use-image-file-picker";

const GHOST_OPACITY = 0.55;

export interface ImagePlacementOverlayProps {
  placement: PendingImagePlacement;
  getCamera(): Camera;
}

export function ImagePlacementOverlay(props: ImagePlacementOverlayProps) {
  const { placement, getCamera } = props;
  // Hidden until the pointer first moves — on touch there is no hover, so the ghost simply never
  // shows and the first tap places the image directly.
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const handleMove = (event: PointerEvent) => setPoint({ x: event.clientX, y: event.clientY });
    window.addEventListener("pointermove", handleMove);
    return () => window.removeEventListener("pointermove", handleMove);
  }, []);

  if (!point) return null;
  const zoom = getCamera().zoom;
  const width = placement.fittedSize.width * zoom;
  const height = placement.fittedSize.height * zoom;
  return (
    <img
      src={placement.dataURL}
      alt=""
      data-testid="image-placement-ghost"
      style={{
        position: "fixed",
        left: point.x - width / 2,
        top: point.y - height / 2,
        width,
        height,
        opacity: GHOST_OPACITY,
        pointerEvents: "none",
        // Above the canvas but below chrome menus/dialogs, so an open menu still covers it.
        zIndex: 80,
      }}
    />
  );
}
