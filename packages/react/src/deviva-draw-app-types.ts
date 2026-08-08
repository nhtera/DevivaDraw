/** Public `<DevivaDraw/>` prop surface — split into its own file so both `deviva-draw-app.tsx` (the provider wrapper) and `deviva-draw-shell.tsx` (the composed chrome, which needs the same shape minus `theme`/`locale`, already consumed by the providers) can reference it without a circular value import. */
import type { AnyElement, SceneDocument } from "@deviva-draw/engine";
import type { CSSProperties } from "react";
import type { Locale } from "./i18n/locale-storage";
import type { ThemeMode } from "./theme/theme-tokens";

export interface DevivaDrawStoredFile {
  mimeType: string;
  dataURL: string;
  createdAt: number;
}

export interface DevivaDrawProps {
  /** A previously-saved scene document (e.g. `handle.getSceneElements()`'s host-persisted counterpart via `Scene.toJSON()`) to load on mount — omit to restore from localStorage autosave instead (the standalone-app default). */
  initialData?: SceneDocument | null;
  /** Fired (debounced) after any user-authored scene change — the embedding-host integration point. */
  onChange?(elements: AnyElement[], files: Record<string, DevivaDrawStoredFile>): void;
  /** `"light"`/`"dark"` to force a theme; omit to use the persisted preference, then the system's `prefers-color-scheme`. */
  theme?: ThemeMode;
  /** `"en"`/`"vi"` to force a language; omit to use the persisted preference, then the browser's own language. */
  locale?: Locale;
  className?: string;
  style?: CSSProperties;
}
