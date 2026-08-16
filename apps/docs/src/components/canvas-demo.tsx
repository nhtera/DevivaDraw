import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import type { DemoSceneName } from './canvas-demo-scenes';

// The heavy half (engine + full React whiteboard) loads only in the browser, after this
// frame hydrates: the `mounted` guard keeps it out of the static build's SSR pass entirely
// (the canvas needs real DOM), and `client:visible` on the island defers even this frame's
// JS until the demo scrolls into view.
const CanvasDemoInner = lazy(() => import('./canvas-demo-inner'));

export interface CanvasDemoProps {
  scene: DemoSceneName;
  height?: number;
  viewOnly?: boolean;
}

export default function CanvasDemo({ scene, height = 420, viewOnly = false }: CanvasDemoProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const fallback: ReactNode = <div className="canvas-demo-loading">Loading live canvas…</div>;

  return (
    <div className="canvas-demo not-content" style={{ height }}>
      {mounted ? (
        <Suspense fallback={fallback}>
          <CanvasDemoInner scene={scene} viewOnly={viewOnly} />
        </Suspense>
      ) : (
        fallback
      )}
    </div>
  );
}
