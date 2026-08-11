/**
 * Fallback for Mermaid diagram types Deviva doesn't natively convert (pie, gantt, gitGraph, mindmap,
 * …): render them with the real `mermaid` library to an SVG, rasterize to a PNG, and let the caller
 * insert it as a normal image element — matching Excalidraw's image fallback.
 *
 * `mermaid` is imported dynamically so it lands in its own lazy chunk and never bloats the main bundle
 * (it only loads the first time a user pastes an unsupported diagram). This is the ONE place the whole
 * codebase depends on `mermaid`; the engine stays entirely dependency-free.
 *
 * The image is always rendered with mermaid's light theme on a white background so the rasterized PNG
 * stays legible on any canvas theme (a static image can't re-theme with the canvas the way native
 * elements do, and mermaid's dark theme emits light text that would vanish on white).
 */
let renderCounter = 0;

/** Pulls pixel dimensions out of a mermaid SVG string (prefers viewBox, falls back to width/height). */
function svgDimensions(svg: string): { width: number; height: number } {
  const viewBox = svg.match(/viewBox="[\d.]+ [\d.]+ ([\d.]+) ([\d.]+)"/);
  if (viewBox) return { width: Math.ceil(Number(viewBox[1])), height: Math.ceil(Number(viewBox[2])) };
  const w = svg.match(/width="([\d.]+)"/);
  const h = svg.match(/height="([\d.]+)"/);
  return { width: w ? Math.ceil(Number(w[1])) : 800, height: h ? Math.ceil(Number(h[1])) : 600 };
}

/** Loads an SVG string as an <img> (via a data URL) so it can be drawn onto a canvas. */
async function loadSvgImage(svg: string, width: number, height: number): Promise<HTMLImageElement> {
  const image = new Image();
  image.width = width;
  image.height = height;
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("mermaid: could not load rendered SVG"));
    image.src = url;
  });
  return image;
}

export interface MermaidImage {
  /** PNG bytes, for `insertImageFile`. */
  bytes: Uint8Array;
  /** A data URL of the same PNG, for the dialog's live preview. */
  dataUrl: string;
}

/**
 * Renders an unsupported Mermaid diagram to a PNG (bytes + preview data URL). Throws on invalid source
 * or a render/rasterize failure — the caller surfaces that as the dialog's inline error.
 */
export async function renderUnsupportedToImage(source: string): Promise<MermaidImage> {
  const mermaid = (await import("mermaid")).default;
  mermaid.initialize({ startOnLoad: false, theme: "default", securityLevel: "strict" });
  renderCounter += 1;
  const { svg } = await mermaid.render(`dd-mermaid-fallback-${renderCounter}`, source);

  const { width, height } = svgDimensions(svg);
  const scale = 2;
  const image = await loadSvgImage(svg, width, height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, width * scale);
  canvas.height = Math.max(1, height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("mermaid: no 2d canvas context");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

  const dataUrl = canvas.toDataURL("image/png");
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("mermaid: PNG rasterization failed");
  return { bytes: new Uint8Array(await blob.arrayBuffer()), dataUrl };
}
