import { describe, expect, it } from "vitest";
import { deserializeMultiPageDocument, Scene, serializeMultiPageDocument } from "@deviva-draw/engine";

/**
 * The share-viewer load path re-serializes the validated pages before the shell deserializes them
 * again (`shared-scene-viewer.tsx`): decrypt → deserialize → serialize → shell deserialize. A page's
 * camera must survive that double round-trip structurally — this test performs the viewer's exact
 * hop so a future "simplification" that rebuilds page literals without the camera field fails here,
 * not just in a slow e2e.
 */
describe("shared scene viewer camera pass-through", () => {
  it("keeps every page's camera across the viewer's deserialize → re-serialize → deserialize chain", () => {
    const shared = serializeMultiPageDocument(
      [
        { id: "p1", name: "Board", scene: new Scene(), camera: { scrollX: -80, scrollY: 45, zoom: 1.25 } },
        { id: "p2", name: "Notes", scene: new Scene(), camera: null },
      ],
      { activePageId: "p1" },
    );

    // What `fetchAndDecryptSharedScene` yields (JSON-parsed ciphertext payload):
    const fetched = JSON.parse(JSON.stringify(shared)) as unknown;

    // The viewer's own hop:
    const validated = deserializeMultiPageDocument(fetched);
    if (!validated.ok) throw new Error(validated.error);
    const reSerialized = serializeMultiPageDocument(validated.pages, { activePageId: validated.activePageId ?? undefined });

    // The shell's deserialize of `initialData`:
    const shellSide = deserializeMultiPageDocument(JSON.parse(JSON.stringify(reSerialized)));
    if (!shellSide.ok) throw new Error(shellSide.error);
    expect(shellSide.activePageId).toBe("p1");
    expect(shellSide.pages[0]!.camera).toEqual({ scrollX: -80, scrollY: 45, zoom: 1.25 });
    expect(shellSide.pages[1]!.camera).toBeNull();
  });
});
