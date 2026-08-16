/**
 * One-shot generator for the committed demo scene JSONs under src/demos/scenes/.
 * Uses the real engine so the files are always valid `SceneDocument`s. Re-run
 * (`node scripts/generate-demo-scenes.mjs` from apps/docs, engine built) only
 * when a demo should change — ids/seeds are random per run, so output churns.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Scene,
  createArrowElement,
  createCloudElement,
  createDiamondElement,
  createEllipseElement,
  createHeartElement,
  createHexagonElement,
  createNoteElement,
  createRectangleElement,
  createStarElement,
  createTextElement,
} from '../../../packages/engine/dist/index.js'; // built dist: the package's exports map resolves to src .ts under Node, which Node can't execute

const outDir = join(dirname(fileURLToPath(import.meta.url)), '../src/demos/scenes');
mkdirSync(outDir, { recursive: true });

/** Adds `text` centered inside `container` as a bound label (the app's label model). */
function addLabel(scene, container, text, fontSize = 20) {
  const label = scene.addElement(
    createTextElement({
      x: container.x + 8,
      y: container.y + container.height / 2 - fontSize * 0.625,
      width: container.width - 16,
      height: fontSize * 1.25,
      text,
      fontSize,
      textAlign: 'center',
      verticalAlign: 'middle',
      containerId: container.id,
    }),
  );
  scene.updateElement(container.id, { boundElements: [{ id: label.id, type: 'text' }] });
}

function writeScene(name, scene) {
  const path = join(outDir, `${name}.json`);
  writeFileSync(path, `${JSON.stringify(scene.toJSON(), null, 2)}\n`);
  console.log(`wrote ${path} (${scene.getElements().length} elements)`);
}

// --- quick-start: an inviting "draw here" scene ---
{
  const scene = new Scene();
  const box = scene.addElement(
    createRectangleElement({ x: 80, y: 120, width: 200, height: 90, backgroundColor: '#a5d8ff', fillStyle: 'solid' }),
  );
  addLabel(scene, box, 'Pick a tool');
  const oval = scene.addElement(
    createEllipseElement({ x: 420, y: 110, width: 200, height: 110, backgroundColor: '#b2f2bb', fillStyle: 'solid' }),
  );
  addLabel(scene, oval, 'Draw shapes');
  scene.addElement(
    createArrowElement({ x: 290, y: 163, width: 120, height: 0, points: [{ x: 0, y: 0 }, { x: 120, y: 0 }] }),
  );
  scene.addElement(
    createNoteElement({ x: 250, y: 290, width: 180, height: 120, backgroundColor: '#ffec99', fillStyle: 'solid' }),
  );
  writeScene('quick-start', scene);
}

// --- shapes-tour: the shape set at a glance ---
{
  const scene = new Scene();
  const shapes = [
    [createDiamondElement, '#ffc9c9'],
    [createStarElement, '#ffec99'],
    [createCloudElement, '#a5d8ff'],
    [createHexagonElement, '#b2f2bb'],
    [createHeartElement, '#eebefa'],
  ];
  shapes.forEach(([create, backgroundColor], i) => {
    scene.addElement(
      create({ x: 60 + i * 170, y: 100 + (i % 2) * 140, width: 130, height: 110, backgroundColor, fillStyle: 'solid' }),
    );
  });
  writeScene('shapes-tour', scene);
}

// --- flowchart: labeled boxes joined by arrows ---
{
  const scene = new Scene();
  const steps = [
    ['Sketch', 60, 140, '#a5d8ff'],
    ['Share', 330, 140, '#b2f2bb'],
    ['Ship', 600, 140, '#ffec99'],
  ];
  for (const [label, x, y, backgroundColor] of steps) {
    const box = scene.addElement(
      createRectangleElement({ x, y, width: 180, height: 80, backgroundColor, fillStyle: 'solid' }),
    );
    addLabel(scene, box, label);
  }
  const arrowPoints = [{ x: 0, y: 0 }, { x: 74, y: 0 }];
  scene.addElement(createArrowElement({ x: 248, y: 180, width: 74, height: 0, points: arrowPoints }));
  scene.addElement(createArrowElement({ x: 518, y: 180, width: 74, height: 0, points: arrowPoints }));
  writeScene('flowchart', scene);
}
