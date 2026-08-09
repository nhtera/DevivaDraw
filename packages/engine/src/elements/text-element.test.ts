import { describe, expect, it } from "vitest";
import { createTextElement } from "./text-element";

describe("createTextElement", () => {
  it("fills in text-specific defaults", () => {
    const element = createTextElement({ x: 10, y: 20 });

    expect(element.type).toBe("text");
    expect(element.text).toBe("");
    expect(element.fontFamily).toBe("hand-drawn-slot"); // the bundled hand-drawn font is the default face
    expect(element.fontSize).toBe(20);
    expect(element.textAlign).toBe("left");
    expect(element.verticalAlign).toBe("top");
    expect(element.lineHeight).toBe(1.25);
    expect(element.containerId).toBeNull();
  });

  it("inherits base element defaults", () => {
    const element = createTextElement({ x: 0, y: 0 });
    expect(element.strokeColor).toBe("#1e1e1e");
    expect(element.boundElements).toBeNull();
    expect(element.isDeleted).toBe(false);
    expect(element.version).toBe(0);
  });

  it("lets the caller override every text-specific field", () => {
    const element = createTextElement({
      x: 0,
      y: 0,
      text: "hello",
      fontFamily: "code",
      fontSize: 28,
      textAlign: "center",
      verticalAlign: "middle",
      lineHeight: 1.5,
      containerId: "container-1",
    });

    expect(element.text).toBe("hello");
    expect(element.fontFamily).toBe("code");
    expect(element.fontSize).toBe(28);
    expect(element.textAlign).toBe("center");
    expect(element.verticalAlign).toBe("middle");
    expect(element.lineHeight).toBe(1.5);
    expect(element.containerId).toBe("container-1");
  });

  it("assigns a unique id per call", () => {
    const a = createTextElement({ x: 0, y: 0 });
    const b = createTextElement({ x: 0, y: 0 });
    expect(a.id).not.toBe(b.id);
  });
});
