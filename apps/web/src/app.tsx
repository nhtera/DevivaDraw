import { ENGINE_VERSION } from "@deviva-draw/react";

/**
 * Application shell. The canvas surface replaces this placeholder once the
 * engine's renderer and React bindings exist.
 */
export function App() {
  return (
    <main>
      <h1>Deviva Draw</h1>
      <p data-testid="engine-version">engine {ENGINE_VERSION}</p>
    </main>
  );
}
