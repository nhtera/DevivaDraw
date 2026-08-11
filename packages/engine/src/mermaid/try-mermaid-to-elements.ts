/**
 * Non-throwing wrapper around `mermaidToElements` for the "Mermaid to diagram" dialog: it needs the
 * detected diagram type (to drive the live preview / unsupported-image fallback) and a stable error
 * code (to show inline feedback) instead of a thrown exception. The converters are designed never to
 * throw, but this guards against any unexpected failure so the dialog can never crash the app.
 *
 * `error` codes are UI-agnostic — the react layer maps them to localized strings:
 *   - "empty": the source is blank.
 *   - "unsupported": a real Mermaid type Deviva can't natively convert *yet* — either a type earmarked
 *     for the image fallback (pie/gantt/…) or one whose native converter lands in a later phase
 *     (sequence/state). Both mean "valid Mermaid, just not renderable here yet", not a syntax error.
 *   - "invalid": parsing a natively-supported type produced nothing usable (a real syntax problem).
 *   - "error": an unexpected exception was caught.
 */
import type { AnyElement } from "../elements/element-types";
import { mermaidToElements } from "./mermaid-to-elements";
import { detectDiagramType } from "./parse/detect-diagram";
import type { DiagramType } from "./parse/detect-diagram";

export type MermaidErrorCode = "empty" | "unsupported" | "invalid" | "error";

export interface MermaidResult {
  type: DiagramType;
  elements: AnyElement[];
  error?: MermaidErrorCode;
}

export function tryMermaidToElements(source: string): MermaidResult {
  const type = detectDiagramType(source);
  if (source.trim().length === 0) return { type, elements: [], error: "empty" };
  try {
    const elements = mermaidToElements(source);
    if (elements.length === 0) {
      // A known non-native type (pie/gantt/…) is "not supported here yet" (rasterized later), whereas a
      // natively-supported type yielding nothing is a genuine syntax problem.
      return { type, elements, error: type === "unsupported" ? "unsupported" : "invalid" };
    }
    return { type, elements };
  } catch {
    return { type, elements: [], error: "error" };
  }
}
