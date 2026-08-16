/**
 * `<DevivaDraw/>` — the public embedding contract: composes the canvas/stage, the input pipeline and
 * tools, persistence/export, and the full UI chrome (toolbar, panels, menus, shortcuts, mobile,
 * theming, i18n) into one component. Wraps `deviva-draw-shell.tsx` (the actual composition) in
 * `<ThemeProvider/>`/`<LocaleProvider/>` so every chrome component underneath can call
 * `useTheme()`/`useTranslation()`.
 */
import { forwardRef } from "react";
import { LocaleProvider } from "./i18n/use-translation";
import { OfflineHintsContext } from "./hooks/use-online";
import { ThemeProvider } from "./theme/theme-provider";
import { DevivaDrawShell } from "./deviva-draw-shell";
import type { DevivaDrawHandle } from "./runtime/imperative-handle";
import type { DevivaDrawProps } from "./deviva-draw-app-types";

export type { DevivaDrawHandle } from "./runtime/imperative-handle";
export type { DevivaDrawProps, DevivaDrawStoredFile } from "./deviva-draw-app-types";

/**
 * The complete Deviva Draw whiteboard as a single React component — canvas, tools, toolbar,
 * panels, menus, shortcuts, theming, i18n, and touch support, with zero required props.
 *
 * @example
 * ```tsx
 * import { DevivaDraw } from "@deviva-draw/react";
 *
 * export default function App() {
 *   return <DevivaDraw style={{ position: "fixed", inset: 0 }} />;
 * }
 * ```
 */
export const DevivaDraw = forwardRef<DevivaDrawHandle, DevivaDrawProps>(function DevivaDraw(props, ref) {
  const { theme, locale, offlineHints, ...shellProps } = props;
  return (
    <LocaleProvider locale={locale}>
      <ThemeProvider theme={theme}>
        <OfflineHintsContext.Provider value={offlineHints ?? false}>
          <DevivaDrawShell {...shellProps} ref={ref} />
        </OfflineHintsContext.Provider>
      </ThemeProvider>
    </LocaleProvider>
  );
});
