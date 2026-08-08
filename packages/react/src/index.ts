/**
 * @deviva-draw/react — React bindings for the Deviva Draw engine.
 *
 * Public entry point: the composed `<DevivaDraw/>` component + its imperative handle (the embedding
 * contract deviva.app and `apps/web` both consume), plus the lower-level hooks/building blocks a host
 * that wants to build its own chrome around the engine can use directly.
 */
export { ENGINE_VERSION } from "@deviva-draw/engine";

// --- Composed app shell (primary public API) ---

export { DevivaDraw } from "./deviva-draw-app";
export type { DevivaDrawHandle, DevivaDrawProps, DevivaDrawStoredFile } from "./deviva-draw-app";
export type { ExportPngOptions, ExportSvgOptions } from "./runtime/imperative-handle";

// --- Theming ---

export { ThemeProvider, useTheme } from "./theme/theme-provider";
export type { ThemeContextValue, ThemeProviderProps } from "./theme/theme-provider";
export type { ThemeMode, ThemeTokens } from "./theme/theme-tokens";
export { resolveThemeTokens, toCssVariables } from "./theme/theme-tokens";
export { adaptBackgroundColorForTheme, adaptStrokeColorForTheme, applyThemeToSceneElements } from "./theme/canvas-color-inversion";

// --- i18n ---

export { LocaleProvider, useTranslation } from "./i18n/use-translation";
export type { LocaleContextValue, LocaleProviderProps } from "./i18n/use-translation";
export type { Locale } from "./i18n/locale-storage";
export type { TranslationKey } from "./i18n/catalog-en";
export { catalogEn } from "./i18n/catalog-en";
export { catalogVi } from "./i18n/catalog-vi";
export { createTranslator } from "./i18n/translate";
export type { Translator } from "./i18n/translate";

// --- Actions ---

export { ActionRegistry } from "./actions/action-registry";
export type { Action, ActionRuntime, GridState, PersistenceOperations, ShareDialogState, UiToggleState } from "./actions/action-types";
export { buildActionRegistry } from "./actions/build-action-registry";
export { formatShortcut, detectIsMac } from "./actions/format-shortcut";
export { fuzzyMatch } from "./actions/fuzzy-match";

// --- Runtime building blocks (for a host building its own chrome around the engine) ---

export { createCameraStore } from "./runtime/camera-store";
export type { CameraStore } from "./runtime/camera-store";
export { buildImperativeHandle } from "./runtime/imperative-handle";
export type { ImperativeHandleDeps } from "./runtime/imperative-handle";
export * from "./runtime/tool-names";

// --- Lower-level components/hooks (phases 07/09) ---

export type { TextEditorOverlayProps } from "./components/text-editor-overlay";
export { TextEditorOverlay } from "./components/text-editor-overlay";

export type { TextEditingOverlay, UseTextEditingOptions } from "./hooks/use-text-editing";
export { useTextEditing } from "./hooks/use-text-editing";

export { shouldCommitOnEnter } from "./hooks/should-commit-on-enter";

export type { MimeTyped } from "./hooks/clipboard-image-detection";
export { findFirstImageItem, isImageMimeType, looksLikeSvgMarkup, SVG_MIME_TYPE, svgMarkupToBytes } from "./hooks/clipboard-image-detection";

export type { UsePasteAndDropOptions } from "./hooks/use-paste-and-drop";
export { usePasteAndDrop } from "./hooks/use-paste-and-drop";

// --- Share links (E2E encrypted, R2-backed) ---

export type { SharedSceneViewerProps } from "./share/shared-scene-viewer";
export { SharedSceneViewer } from "./share/shared-scene-viewer";

// --- Live collaboration (E2E encrypted, Durable Objects relay) ---

export type { CollabErrorReason, UseCollabSessionOptions, UseCollabSessionResult } from "./hooks/use-collab-session";
export { useCollabSession } from "./hooks/use-collab-session";
export type { UseCollabCursorTrackingOptions } from "./hooks/use-collab-cursor-tracking";
export { useCollabCursorTracking } from "./hooks/use-collab-cursor-tracking";
export { randomGuestColor, randomGuestName } from "./hooks/random-collab-identity";
export type { CollabDialogProps } from "./components/collab-dialog";
export { CollabDialog } from "./components/collab-dialog";
