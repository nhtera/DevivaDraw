/**
 * Main-menu "Canvas background" control — Excalidraw's per-scene background swatch. The color is a
 * document setting on the scene (`Scene.getBackground`), so it persists through every save/autosave/
 * share path and bakes into exports. The first swatch is the current theme's default; picking it
 * clears the override (`setBackground(null)`) so the canvas follows the theme again; any other color
 * pins that background regardless of theme (matching Excalidraw's theme-independent view background).
 */
import type { Scene } from "@deviva-draw/engine";
import { ColorPicker } from "./color-picker";
import { useCanvasBackground } from "../runtime/use-live-version";
import { useTranslation } from "../i18n/use-translation";
import { useTheme } from "../theme/theme-provider";
import { resolveThemeTokens } from "../theme/theme-tokens";

/** Soft, low-saturation tints that read as a subtle paper color rather than a loud fill. */
const CANVAS_BACKGROUND_TINTS = ["#f8f9fa", "#fff9db", "#f4fce3", "#e7f5ff", "#fff0f6"] as const;

export function CanvasBackgroundRow(props: { scene: Scene }) {
  const { scene } = props;
  const { t } = useTranslation();
  const { mode } = useTheme();
  const current = useCanvasBackground(scene);
  const themeDefault = resolveThemeTokens(mode).canvasBackground;
  const palette = [themeDefault, ...CANVAS_BACKGROUND_TINTS];

  return (
    <ColorPicker
      label={t("menu.canvasBackground")}
      testId="canvas-background"
      value={current ?? themeDefault}
      palette={palette}
      recentColors={[]}
      customColorLabel={t("panel.customColor")}
      onChange={(color) => scene.setBackground(color.toLowerCase() === themeDefault.toLowerCase() ? null : color)}
    />
  );
}
