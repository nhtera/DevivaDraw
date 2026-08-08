/**
 * `CanvasStage`: the framework-agnostic controller that owns the two stacked `<canvas>` elements
 * (static + interactive) and all DOM/devicePixelRatio plumbing. Everything that can be pure logic
 * (camera math, culling, the redraw-skip decision) lives in sibling modules and is unit tested
 * there; this file is intentionally thin — it only creates elements, sizes them, and wires a
 * `ResizeObserver` — so there's as little browser-only, hard-to-test surface as possible.
 *
 * Not unit tested: `document`/`ResizeObserver`/`HTMLCanvasElement` don't exist under the engine
 * package's node test environment (no `jsdom`/`node-canvas` dependency was pulled in for this —
 * see the phase report for the explicit trade-off). Verified manually via the dev harness in
 * `apps/web` instead.
 */
import { InteractiveLayer } from "./interactive-layer";
import { StaticLayer } from "./static-layer";

function createLayerCanvas(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.style.position = "absolute";
  canvas.style.inset = "0";
  return canvas;
}

export class CanvasStage {
  readonly staticLayer: StaticLayer;
  readonly interactiveLayer: InteractiveLayer;

  private readonly staticCanvas: HTMLCanvasElement;
  private readonly interactiveCanvas: HTMLCanvasElement;
  private container: HTMLElement | null = null;
  private resizeObserver: ResizeObserver | null = null;

  constructor() {
    this.staticCanvas = createLayerCanvas();
    this.interactiveCanvas = createLayerCanvas();

    const staticCtx = this.staticCanvas.getContext("2d");
    const interactiveCtx = this.interactiveCanvas.getContext("2d");
    if (!staticCtx || !interactiveCtx) {
      throw new Error("canvas-stage: 2d rendering context unavailable");
    }

    this.staticLayer = new StaticLayer(staticCtx);
    this.interactiveLayer = new InteractiveLayer(interactiveCtx);
  }

  /** Appends both canvases into `container` and starts observing its size for resize/DPR handling. */
  mount(container: HTMLElement): void {
    this.container = container;
    // The two canvases stack via absolute positioning, which requires a positioned ancestor —
    // force one instead of relying on every caller to remember it on the container it passes in.
    if (globalThis.getComputedStyle(container).position === "static") {
      container.style.position = "relative";
    }
    container.append(this.staticCanvas, this.interactiveCanvas);
    this.resize();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
  }

  /** Detaches both canvases and stops observing. Safe to call even if never mounted. */
  unmount(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.staticCanvas.remove();
    this.interactiveCanvas.remove();
    this.container = null;
  }

  /**
   * Resizes the backing store to `containerSize * devicePixelRatio` (retina-sharp), keeps the CSS
   * box at the container's logical size, and re-applies the DPR scale so every draw call after
   * this can keep using CSS-pixel coordinates. Invalidates the static layer's cache: its cheap
   * fingerprint check compares `canvas.clientWidth/clientHeight`, which just changed.
   */
  private resize(): void {
    const container = this.container;
    if (!container) return;

    const { clientWidth, clientHeight } = container;
    const dpr = globalThis.devicePixelRatio || 1;

    for (const canvas of [this.staticCanvas, this.interactiveCanvas]) {
      canvas.width = Math.max(1, Math.round(clientWidth * dpr));
      canvas.height = Math.max(1, Math.round(clientHeight * dpr));
      canvas.style.width = `${clientWidth}px`;
      canvas.style.height = `${clientHeight}px`;
      // setTransform (not scale) so repeated resizes don't compound the DPR factor.
      canvas.getContext("2d")?.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    this.staticLayer.invalidate();
  }
}
