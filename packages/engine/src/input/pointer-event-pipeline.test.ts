import { describe, expect, it } from "vitest";
import { buildHarness } from "./pointer-event-pipeline-test-harness";

describe("PointerEventPipeline gesture routing", () => {
  it("routes down->move->move->up as scene-space points through the active tool", () => {
    const { element, selectTool, cameraState } = buildHarness();
    cameraState.camera = { scrollX: 0, scrollY: 0, zoom: 2 };

    element.firePointerDown({ pointerId: 1, clientX: 20, clientY: 40 });
    element.firePointerMove({ pointerId: 1, clientX: 40, clientY: 60 });
    element.firePointerUp({ pointerId: 1, clientX: 60, clientY: 80 });

    // screenToScene at zoom 2: x/2, y/2
    expect(selectTool.calls).toEqual(["start:10,20", "move:20,30", "end:30,40"]);
  });

  it("captures the pointer on gesture start and ignores events from a different pointer id", () => {
    const { element, selectTool } = buildHarness();
    element.firePointerDown({ pointerId: 1, clientX: 0, clientY: 0 });
    element.firePointerMove({ pointerId: 2, clientX: 999, clientY: 999 });
    expect(element.capturedPointerIds).toEqual([1]);
    expect(selectTool.calls).toEqual(["start:0,0"]);
  });

  it("freezes the gesture's camera at gesture start: a live camera change mid-gesture doesn't perturb reported points", () => {
    const { element, selectTool, cameraState } = buildHarness();
    element.firePointerDown({ pointerId: 1, clientX: 100, clientY: 100 });
    cameraState.camera = { scrollX: 500, scrollY: 500, zoom: 5 }; // simulate an external camera mutation
    element.firePointerMove({ pointerId: 1, clientX: 110, clientY: 110 });
    // Still converted with the camera captured at gesture start (identity), not the mutated one.
    expect(selectTool.calls).toEqual(["start:100,100", "move:110,110"]);
  });

  it("ignores a second pointerdown with a different id while a gesture is already active", () => {
    const { element, selectTool, cameraState } = buildHarness();
    cameraState.camera = { scrollX: 0, scrollY: 0, zoom: 1 };

    element.firePointerDown({ pointerId: 1, clientX: 0, clientY: 0 });
    element.firePointerDown({ pointerId: 2, clientX: 500, clientY: 500 }); // a second touch/palm
    expect(selectTool.calls).toEqual(["start:0,0"]); // the second down never reached the tool

    // The original gesture is unaffected and still completes normally on its own pointerup.
    element.firePointerUp({ pointerId: 1, clientX: 10, clientY: 10 });
    expect(selectTool.calls).toEqual(["start:0,0", "end:10,10"]);
  });
});

describe("PointerEventPipeline pressure/pointerType threading", () => {
  it("forwards real pressure/pointerType from the event through to the active tool", () => {
    const { element, selectTool } = buildHarness();
    element.firePointerDown({ pointerId: 1, clientX: 0, clientY: 0, pressure: 0.8, pointerType: "pen" });
    expect(selectTool.pointerSamples[0]).toEqual({ pressure: 0.8, pointerType: "pen" });
  });

  it("defaults to simulated pressure (0.5) and pointerType 'mouse' when the event omits them", () => {
    const { element, selectTool } = buildHarness();
    element.firePointerDown({ pointerId: 1, clientX: 0, clientY: 0 });
    expect(selectTool.pointerSamples[0]).toEqual({ pressure: 0.5, pointerType: "mouse" });
  });

  it("threads pressure through every stage of the gesture, not just gesture start", () => {
    const { element, selectTool } = buildHarness();
    element.firePointerDown({ pointerId: 1, clientX: 0, clientY: 0, pressure: 0.9, pointerType: "pen" });
    element.firePointerMove({ pointerId: 1, clientX: 1, clientY: 1, pressure: 0.3, pointerType: "pen" });
    element.firePointerUp({ pointerId: 1, clientX: 2, clientY: 2, pressure: 0.1, pointerType: "pen" });
    expect(selectTool.pointerSamples.map((sample) => sample.pressure)).toEqual([0.9, 0.3, 0.1]);
  });
});

describe("PointerEventPipeline wheel", () => {
  it("plain wheel pans the camera (trackpad two-finger-scroll convention)", () => {
    const { element, cameraState } = buildHarness();
    cameraState.camera = { scrollX: 0, scrollY: 0, zoom: 1 };
    element.fireWheel({ clientX: 0, clientY: 0, deltaX: 20, deltaY: 10 });
    expect(cameraState.camera).toEqual({ scrollX: -20, scrollY: -10, zoom: 1 });
  });

  it("ctrl+wheel zooms instead of panning", () => {
    const { element, cameraState } = buildHarness();
    element.fireWheel({ clientX: 400, clientY: 300, deltaX: 0, deltaY: -100, ctrlKey: true });
    expect(cameraState.camera.zoom).toBeGreaterThan(1);
  });

  it("always calls preventDefault, so the browser's own page-zoom/ancestor-scroll never fires over the canvas", () => {
    const { element } = buildHarness();
    const plain = element.fireWheel({ clientX: 0, clientY: 0, deltaX: 5, deltaY: 5 });
    const zoom = element.fireWheel({ clientX: 0, clientY: 0, deltaX: 0, deltaY: -5, ctrlKey: true });
    expect(plain.preventDefault).toHaveBeenCalledTimes(1);
    expect(zoom.preventDefault).toHaveBeenCalledTimes(1);
  });
});

describe("PointerEventPipeline keyboard shortcuts", () => {
  it("a resolved shortcut action runs the registered handler instead of reaching the active tool", () => {
    const { globalTarget, selectTool, toolStateMachine } = buildHarness();
    globalTarget.fireKeyDown("h");
    expect(toolStateMachine.getActiveToolName()).toBe("pan");
    expect(selectTool.calls).toEqual([]); // "h" never reached select tool's onKeyDown
  });

  it("an unrecognized key forwards to the active tool's onKeyDown", () => {
    const { globalTarget, selectTool } = buildHarness();
    globalTarget.fireKeyDown("a");
    expect(selectTool.calls).toEqual(["key:a"]);
  });

  it("shift+1 (zoom-to-fit) no-ops cleanly with no scene bounds available", () => {
    const { globalTarget, cameraState } = buildHarness();
    const before = cameraState.camera;
    globalTarget.fireKeyDown("1", { shift: true });
    expect(cameraState.camera).toBe(before);
  });

  it("preventDefault is called for a recognized shortcut but not for an unhandled key", () => {
    const { globalTarget } = buildHarness();
    const shortcutEvent = globalTarget.fireKeyDown("h");
    const unhandledEvent = globalTarget.fireKeyDown("a");
    expect(shortcutEvent.preventDefault).toHaveBeenCalledTimes(1);
    expect(unhandledEvent.preventDefault).not.toHaveBeenCalled();
  });

  it("Space always calls preventDefault (prevents the page from scrolling while held)", () => {
    const { globalTarget } = buildHarness();
    const event = globalTarget.fireKeyDown(" ");
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
  });

  it("Escape with no gesture in progress does not call preventDefault (nothing to cancel)", () => {
    const { globalTarget } = buildHarness();
    const event = globalTarget.fireKeyDown("Escape");
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});

describe("PointerEventPipeline gesture-active camera guard", () => {
  it("wheel pan/zoom is ignored (but still preventDefault'd) while a gesture is in progress", () => {
    const { element, cameraState } = buildHarness();
    cameraState.camera = { scrollX: 0, scrollY: 0, zoom: 1 };
    element.firePointerDown({ pointerId: 1, clientX: 0, clientY: 0 });

    const before = cameraState.camera;
    const event = element.fireWheel({ clientX: 0, clientY: 0, deltaX: 50, deltaY: 50 });
    expect(cameraState.camera).toBe(before); // untouched
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
  });

  it("a zoom-in/zoom-out/zoom-to-fit shortcut is ignored while a gesture is in progress", () => {
    const { element, globalTarget, cameraState } = buildHarness();
    element.firePointerDown({ pointerId: 1, clientX: 0, clientY: 0 });

    const before = cameraState.camera;
    globalTarget.fireKeyDown("=", { ctrl: true }); // "zoom-in"
    expect(cameraState.camera).toBe(before);
  });

  it("wheel works again once the gesture that blocked it has ended", () => {
    const { element, cameraState } = buildHarness();
    cameraState.camera = { scrollX: 0, scrollY: 0, zoom: 1 };
    element.firePointerDown({ pointerId: 1, clientX: 0, clientY: 0 });
    element.fireWheel({ clientX: 0, clientY: 0, deltaX: 50, deltaY: 50 }); // ignored
    element.firePointerUp({ pointerId: 1, clientX: 0, clientY: 0 });

    element.fireWheel({ clientX: 0, clientY: 0, deltaX: 20, deltaY: 10 });
    expect(cameraState.camera).toEqual({ scrollX: -20, scrollY: -10, zoom: 1 });
  });
});

describe("PointerEventPipeline text-editing suppression", () => {
  it("suppresses shortcut resolution entirely while suppressed — no tool switch, no forward to the active tool", () => {
    const { globalTarget, selectTool, toolStateMachine, editingSuppressionState } = buildHarness();
    editingSuppressionState.suppressed = true;

    globalTarget.fireKeyDown("h"); // normally resolves to the "pan-tool" shortcut
    globalTarget.fireKeyDown("a"); // normally forwards to the active tool's onKeyDown

    expect(toolStateMachine.getActiveToolName()).toBe("select");
    expect(selectTool.calls).toEqual([]);
  });

  it("does not call preventDefault while suppressed, leaving the textarea's native key handling untouched", () => {
    const { globalTarget, editingSuppressionState } = buildHarness();
    editingSuppressionState.suppressed = true;

    const event = globalTarget.fireKeyDown("h");
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("does not arm the space-held pan override while suppressed", () => {
    const { globalTarget, editingSuppressionState } = buildHarness();
    editingSuppressionState.suppressed = true;

    const event = globalTarget.fireKeyDown(" ");
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("shortcuts resolve normally again once suppression is lifted", () => {
    const { globalTarget, toolStateMachine, editingSuppressionState } = buildHarness();
    editingSuppressionState.suppressed = true;
    globalTarget.fireKeyDown("h");
    expect(toolStateMachine.getActiveToolName()).toBe("select"); // still suppressed

    editingSuppressionState.suppressed = false;
    globalTarget.fireKeyDown("h");
    expect(toolStateMachine.getActiveToolName()).toBe("pan");
  });
});

describe("PointerEventPipeline.detach", () => {
  it("disposes both targets", () => {
    const { pipeline, element, globalTarget } = buildHarness();
    pipeline.detach();
    expect(element.disposed).toBe(true);
    expect(globalTarget.disposed).toBe(true);
  });
});

describe("PointerEventPipeline hover routing", () => {
  it("routes a pointer move with no gesture in progress to the tool as a hover", () => {
    const { element, selectTool, cameraState } = buildHarness();
    cameraState.camera = { scrollX: 0, scrollY: 0, zoom: 2 };

    element.firePointerMove({ pointerId: 1, clientX: 40, clientY: 60 });

    expect(selectTool.calls).toEqual(["hover:20,30"]);
  });

  it("reads the live camera for a hover, since there is no gesture whose frame needs freezing", () => {
    const { element, selectTool, cameraState } = buildHarness();
    element.firePointerMove({ pointerId: 1, clientX: 100, clientY: 100 });
    cameraState.camera = { scrollX: 0, scrollY: 0, zoom: 4 };
    element.firePointerMove({ pointerId: 1, clientX: 100, clientY: 100 });

    // The same screen point resolves differently once the camera moves — a stale frozen camera would
    // report the first point twice.
    expect(selectTool.calls).toEqual(["hover:100,100", "hover:25,25"]);
  });

  it("does not report hovers during a gesture — that movement belongs to the gesture", () => {
    const { element, selectTool } = buildHarness();
    element.firePointerDown({ pointerId: 1, clientX: 0, clientY: 0 });
    element.firePointerMove({ pointerId: 1, clientX: 10, clientY: 10 });

    expect(selectTool.calls).toEqual(["start:0,0", "move:10,10"]);
  });

  it("drops a stray second pointer's movement mid-gesture instead of reporting it as a hover", () => {
    const { element, selectTool } = buildHarness();
    element.firePointerDown({ pointerId: 1, clientX: 0, clientY: 0 });
    element.firePointerMove({ pointerId: 2, clientX: 999, clientY: 999 }); // a palm or second finger

    expect(selectTool.calls).toEqual(["start:0,0"]);
  });

  it("resumes reporting hovers once the gesture ends", () => {
    const { element, selectTool } = buildHarness();
    element.firePointerDown({ pointerId: 1, clientX: 0, clientY: 0 });
    element.firePointerUp({ pointerId: 1, clientX: 5, clientY: 5 });
    element.firePointerMove({ pointerId: 1, clientX: 30, clientY: 30 });

    expect(selectTool.calls).toEqual(["start:0,0", "end:5,5", "hover:30,30"]);
  });
});
