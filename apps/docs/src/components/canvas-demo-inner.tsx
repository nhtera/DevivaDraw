import { useEffect, useRef, useState } from 'react';
import { DevivaDraw, type DevivaDrawHandle, type ThemeMode } from '@deviva-draw/react';
import type { DemoSceneName } from './canvas-demo-scenes';
import quickStart from '../demos/scenes/quick-start.json';
import shapesTour from '../demos/scenes/shapes-tour.json';
import flowchart from '../demos/scenes/flowchart.json';

const SCENES: Record<DemoSceneName, unknown> = {
  'quick-start': quickStart,
  'shapes-tour': shapesTour,
  flowchart,
};

/** Starlight resolves the visitor's theme choice onto `<html data-theme>`; mirror it live so the demo canvas follows the site's toggle. */
function readSiteTheme(): ThemeMode {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

function useSiteTheme(): ThemeMode {
  const [theme, setTheme] = useState<ThemeMode>(readSiteTheme);
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(readSiteTheme()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);
  return theme;
}

export default function CanvasDemoInner({ scene, viewOnly }: { scene: DemoSceneName; viewOnly: boolean }) {
  const handle = useRef<DevivaDrawHandle>(null);
  const theme = useSiteTheme();
  // Passing initialData keeps the demo out of the package's localStorage autosave — each
  // page view starts from the committed scene and visitor doodles never persist or leak
  // between demos.
  const doc = SCENES[scene] as never;

  return (
    <>
      <DevivaDraw
        ref={handle}
        initialData={doc}
        theme={theme}
        initialViewOnly={viewOnly}
        style={{ position: 'absolute', inset: 0 }}
      />
      <button
        type="button"
        className="canvas-demo-reset"
        onClick={() => handle.current?.loadSceneDocument(doc)}
      >
        Reset demo
      </button>
    </>
  );
}
