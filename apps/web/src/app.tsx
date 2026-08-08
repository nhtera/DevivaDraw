import { ENGINE_VERSION } from "@deviva-draw/react";
import { DevCanvasHarness } from "./dev-canvas-harness";

/**
 * Application shell. Mounts the temporary `DevCanvasHarness` to manually verify the renderer's
 * pan/zoom/culling behavior — replaced by the real tool/input UI once that pipeline exists.
 */
export function App() {
  return (
    <main>
      <h1>Deviva Draw</h1>
      <p data-testid="engine-version">engine {ENGINE_VERSION}</p>
      <DevCanvasHarness />
    </main>
  );
}
