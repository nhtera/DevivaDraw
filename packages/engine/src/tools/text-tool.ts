/**
 * Click-to-place standalone text tool: creates an empty `TextElement` at the click point and hands
 * off to `TextEditSession` for the actual typing. This tool's whole job ends the moment the draft
 * exists and a session is open — the (React-layer) overlay owns everything from there, same
 * division of labor bound-text editing uses (see `text/bound-text.ts`'s `startBoundTextEdit`).
 */
import { createTextElement } from "../elements/text-element";
import { NoOpToolHandler } from "../input/tool-handler";
import type { ModifierKeys } from "../input/tool-handler";
import type { Point } from "../render/camera";
import type { Scene } from "../scene/scene";
import { TEXT_FONT_FAMILY_CSS } from "../text/font-loading";
import type { TextEditSession } from "../text/text-edit-session";
import { buildFontCssString, measureWrappedText } from "../text/text-measurement";
import type { TextMeasurer } from "../text/text-measurement";
import type { ShapeStyleState } from "./shape-style-state";

export interface TextToolDeps {
  scene: Scene;
  styleState: ShapeStyleState;
  editSession: TextEditSession;
  /** Measures the committed text's natural (unwrapped) size so the element's `width`/`height` — left at `0` by `createTextElement`'s defaults — match its actual rendered footprint once real text lands, for rotation-center/alignment math and future hit-testing/selection to work against. */
  measurer: TextMeasurer;
  /** Called once the draft is placed and its edit session is open — the host uses this to switch back to the select tool, the click-to-place-then-select UX every text tool in this genre uses. */
  onPlaced?: (elementId: string) => void;
}

/** Standalone text never wraps except at explicit `\n` (see `text-measurement.ts`'s `wrapText` doc on `maxWidth: Infinity`) — its box just grows to fit whatever the user typed. */
function syncStandaloneTextSize(scene: Scene, elementId: string, finalText: string, measurer: TextMeasurer): void {
  const element = scene.getElement(elementId);
  if (!element || element.isDeleted || element.type !== "text") return;

  const fontCss = buildFontCssString(element.fontSize, TEXT_FONT_FAMILY_CSS[element.fontFamily]);
  const metrics = measureWrappedText(finalText, {
    measurer,
    fontCss,
    fontSizePx: element.fontSize,
    lineHeightMultiplier: element.lineHeight,
    maxWidth: Number.POSITIVE_INFINITY,
  });
  scene.updateElement(elementId, { width: metrics.widthPx, height: metrics.totalHeightPx });
}

export class TextTool extends NoOpToolHandler {
  private readonly deps: TextToolDeps;

  constructor(deps: TextToolDeps) {
    super();
    this.deps = deps;
  }

  /* eslint-disable @typescript-eslint/no-unused-vars -- `modifiers` kept to match `ToolHandler`'s signature; a plain click needs no modifier reads */
  override onGestureStart(point: Point, modifiers: ModifierKeys): void {
    const style = this.deps.styleState.getStyle();
    const stored = this.deps.scene.addElement(
      createTextElement({ x: point.x, y: point.y, strokeColor: style.strokeColor, opacity: style.opacity }),
    );
    this.deps.editSession.start({
      elementId: stored.id,
      initialText: "",
      isNewElement: true,
      onCommitted: (elementId, finalText) => syncStandaloneTextSize(this.deps.scene, elementId, finalText, this.deps.measurer),
    });
    this.deps.onPlaced?.(stored.id);
  }
  /* eslint-enable @typescript-eslint/no-unused-vars */
}
