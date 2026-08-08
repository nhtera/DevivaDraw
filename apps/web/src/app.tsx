import { useEffect } from "react";
import { DevivaDraw } from "@deviva-draw/react";

/**
 * Application shell for the standalone Deviva Draw app (draw.deviva.app) — a thin wrapper around the
 * composed `<DevivaDraw/>` component from `@deviva-draw/react`, full-screen, with no props overridden
 * (theme/locale default to the persisted preference or the browser/system default; scene data
 * defaults to localStorage autosave restore/save, this app's whole persistence story). Every actual
 * feature (canvas, tools, toolbar, panels, menus, shortcuts, mobile/touch, theming, i18n) lives in
 * `@deviva-draw/react` — this app is just the browser tab that hosts it.
 */
export function App() {
  useEffect(() => {
    document.title = "Deviva Draw";
  }, []);

  return <DevivaDraw style={{ position: "fixed", inset: 0 }} />;
}
