import { describe, expect, it } from "vitest";
import { createFrameElement, MAX_FRAME_NOTES_LENGTH } from "../elements/frame-element";
import type { FrameElement } from "../elements/frame-element";
import { Scene } from "../scene/scene";
import { deserializeScene, deserializeSceneLenient, serializeScene } from "./serialize-scene";

const roundTrip = (scene: Scene): Scene => {
  const raw = JSON.parse(JSON.stringify(serializeScene(scene))) as unknown;
  const result = deserializeScene(raw);
  if (!result.ok) throw new Error(result.error);
  return result.scene;
};

/** A serialized scene holding one frame with `notes` forced to `value` — the hand-edited/hostile document shape. */
function documentWithFrameNotes(value: unknown): unknown {
  const scene = new Scene();
  scene.addElement(createFrameElement({ x: 0, y: 0, width: 100, height: 60, name: "Intro" }));
  const document = JSON.parse(JSON.stringify(serializeScene(scene))) as { elements: Record<string, unknown>[] };
  document.elements[0]!.notes = value;
  return document;
}

describe("frame presenter notes", () => {
  it("omits the field entirely on a frame that has none, so old documents stay byte-identical", () => {
    const scene = new Scene();
    scene.addElement(createFrameElement({ x: 0, y: 0, width: 100, height: 60, name: "Intro" }));
    expect(JSON.stringify(serializeScene(scene))).not.toContain("notes");
  });

  it("round-trips notes through save and reload", () => {
    const scene = new Scene();
    const frame = scene.addElement(createFrameElement({ x: 0, y: 0, width: 100, height: 60, name: "Intro", notes: "Open with the demo.\nThen the numbers." }));
    const restored = roundTrip(scene).getElement(frame.id) as FrameElement;
    expect(restored.notes).toBe("Open with the demo.\nThen the numbers.");
  });

  it("truncates over-long notes at creation rather than storing an unbounded string", () => {
    const frame = createFrameElement({ x: 0, y: 0, width: 10, height: 10, notes: "x".repeat(MAX_FRAME_NOTES_LENGTH + 100) });
    expect(frame.notes).toHaveLength(MAX_FRAME_NOTES_LENGTH);
  });

  it("survives a document authored before the field existed", () => {
    const result = deserializeScene(documentWithFrameNotes(undefined));
    expect(result.ok).toBe(true);
  });

  it("rejects a wrong-typed or over-long notes field instead of trusting it", () => {
    expect(deserializeScene(documentWithFrameNotes(42)).ok).toBe(false);
    expect(deserializeScene(documentWithFrameNotes("x".repeat(MAX_FRAME_NOTES_LENGTH + 1))).ok).toBe(false);
  });

  it("drops only the offending frame in the lenient path, keeping the rest of the board", () => {
    const scene = new Scene();
    scene.addElement(createFrameElement({ x: 0, y: 0, width: 100, height: 60, name: "Keep me" }));
    scene.addElement(createFrameElement({ x: 200, y: 0, width: 100, height: 60, name: "Corrupt" }));
    const document = JSON.parse(JSON.stringify(serializeScene(scene))) as { elements: Record<string, unknown>[] };
    document.elements[1]!.notes = 42;
    const lenient = deserializeSceneLenient(document);
    if (!lenient.ok) throw new Error(lenient.error);
    expect(lenient.scene.getElements()).toHaveLength(1);
    expect(lenient.droppedErrors.join(" ")).toContain("notes");
  });
});
