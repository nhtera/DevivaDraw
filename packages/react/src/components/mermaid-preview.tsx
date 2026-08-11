/**
 * Live preview pane for the Mermaid dialog. Renders the parsed Deviva elements with the engine's real
 * `exportToSvg` (the same renderer the export feature uses), so the preview is faithful to the inserted
 * result — no separate/approximate draw path. Self-contained: it owns a throwaway `Scene` plus a rough
 * generator + text measurer, so no runtime/shell plumbing is needed. Elements are drawn on a white
 * "paper" background so the diagram is legible in both light and dark dialog themes.
 */
import { createCanvasTextMeasurer, exportToSvg, Scene } from "@deviva-draw/engine";
import type { AnyElement } from "@deviva-draw/engine";
import type { CSSProperties } from "react";
import { useMemo } from "react";
import { createRoughSvgGenerator } from "../browser/persistence-adapters";

const previewStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: 180,
  maxHeight: 260,
  overflow: "auto",
  background: "#ffffff",
  border: "1px solid var(--dd-chrome-border)",
  borderRadius: 8,
  padding: 8,
  boxSizing: "border-box",
};

/** Makes the exported SVG scale to fit the pane instead of rendering at its intrinsic pixel size. */
function fitToPane(svg: string): string {
  return svg.replace("<svg ", '<svg style="max-width:100%;max-height:244px;height:auto;width:auto" ');
}

export function MermaidPreview({ elements }: { elements: readonly AnyElement[] }) {
  const measurer = useMemo(() => createCanvasTextMeasurer(document.createElement("canvas").getContext("2d")!), []);
  const roughGenerator = useMemo(() => createRoughSvgGenerator(), []);
  const scene = useMemo(() => new Scene(), []);

  const svg = useMemo(() => {
    if (elements.length === 0) return "";
    return fitToPane(
      exportToSvg({ scene, roughGenerator, textMeasurer: measurer, elements, padding: 12, backgroundColor: "#ffffff", embedSceneData: false }),
    );
  }, [elements, scene, roughGenerator, measurer]);

  if (!svg) return null;
  // The SVG is produced by our own trusted engine renderer from parsed Mermaid (no external HTML).
  return <div data-testid="mermaid-preview" style={previewStyle} dangerouslySetInnerHTML={{ __html: svg }} />;
}
