/**
 * Canvas-aware color inversion: the rule that keeps dark mode from looking broken on a scene with
 * custom colors. Only colors that exactly match one of the
 * engine's own *default* palette entries (`DEFAULT_STROKE_COLOR_PALETTE`/`DEFAULT_BACKGROUND_COLOR_PALETTE`
 * — the swatches a fresh element gets before a user ever touches the color picker) are swapped for
 * their dark-mode counterpart; anything else (a user's deliberately-chosen custom hex, e.g. for
 * print/export) passes through untouched. The canvas *background* itself is a separate, always-swapped
 * theme token (`theme-tokens.ts`'s `canvasBackground`) — this module only ever touches element colors.
 */
import { DEFAULT_BACKGROUND_COLOR_PALETTE, DEFAULT_STROKE_COLOR_PALETTE } from "@deviva-draw/engine";
import type { AnyElement, Scene } from "@deviva-draw/engine";
import type { ThemeMode } from "./theme-tokens";

/** Dark-mode counterparts for `DEFAULT_STROKE_COLOR_PALETTE`, same order/length — each entry is a lightened version legible against a dark canvas background. */
const DARK_STROKE_COLOR_PALETTE: readonly string[] = ["#e9ecef", "#ff8787", "#69db7c", "#74c0fc", "#ffd43b"];
/** Dark-mode counterparts for `DEFAULT_BACKGROUND_COLOR_PALETTE`, same order/length — `"transparent"` maps to itself (theme-independent). */
const DARK_BACKGROUND_COLOR_PALETTE: readonly string[] = ["transparent", "#5c2b2b", "#1f3d24", "#173252", "#4a3c12"];

function buildBidirectionalMap(light: readonly string[], dark: readonly string[]): { lightToDark: Map<string, string>; darkToLight: Map<string, string> } {
  const lightToDark = new Map<string, string>();
  const darkToLight = new Map<string, string>();
  light.forEach((lightColor, index) => {
    const darkColor = dark[index];
    if (darkColor === undefined) return;
    lightToDark.set(lightColor, darkColor);
    darkToLight.set(darkColor, lightColor);
  });
  return { lightToDark, darkToLight };
}

const STROKE_MAP = buildBidirectionalMap(DEFAULT_STROKE_COLOR_PALETTE, DARK_STROKE_COLOR_PALETTE);
const BACKGROUND_MAP = buildBidirectionalMap(DEFAULT_BACKGROUND_COLOR_PALETTE, DARK_BACKGROUND_COLOR_PALETTE);

function adaptViaMap(color: string, mode: ThemeMode, map: { lightToDark: Map<string, string>; darkToLight: Map<string, string> }): string {
  const lookup = mode === "dark" ? map.lightToDark : map.darkToLight;
  return lookup.get(color) ?? color;
}

/** Adapts a single stroke color for `mode` — a known default-palette entry swaps to its counterpart; any other (explicit/custom) color is returned unchanged. */
export function adaptStrokeColorForTheme(color: string, mode: ThemeMode): string {
  return adaptViaMap(color, mode, STROKE_MAP);
}

/** Adapts a single background/fill color for `mode` — same rule as `adaptStrokeColorForTheme`, over the background palette. */
export function adaptBackgroundColorForTheme(color: string, mode: ThemeMode): string {
  return adaptViaMap(color, mode, BACKGROUND_MAP);
}

export interface ThemeSwapHistory {
  beginBatch(): void;
  endBatch(snapshot: AnyElement[]): void;
}

/**
 * Walks every non-deleted element in `scene` and swaps its `strokeColor`/`backgroundColor` for the
 * `mode` counterpart wherever it matches a known default-palette entry — called once by
 * `theme-provider.tsx` whenever the theme toggles. The two-way map (see `buildBidirectionalMap`)
 * makes this idempotent under repeated toggling: light -> dark -> light restores the exact original
 * color, never drifting. `history`, when provided, batches every touched element into a single undo
 * step (consistent with every other multi-element scene mutation in this codebase) rather than one
 * step per element.
 */
export function applyThemeToSceneElements(scene: Scene, mode: ThemeMode, history?: ThemeSwapHistory): void {
  const run = () => {
    for (const element of scene.getElements()) {
      if (element.isDeleted) continue;
      const nextStroke = adaptStrokeColorForTheme(element.strokeColor, mode);
      const nextBackground = adaptBackgroundColorForTheme(element.backgroundColor, mode);
      if (nextStroke === element.strokeColor && nextBackground === element.backgroundColor) continue;
      scene.updateElement(element.id, { strokeColor: nextStroke, backgroundColor: nextBackground });
    }
  };

  if (!history) {
    run();
    return;
  }
  history.beginBatch();
  run();
  history.endBatch(scene.getElements());
}
