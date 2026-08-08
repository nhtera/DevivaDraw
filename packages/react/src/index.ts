/**
 * @deviva-draw/react — React bindings for the Deviva Draw engine.
 *
 * Will export the <DevivaDraw/> component, imperative handle, hooks, and the
 * scene-read API used by embedders (e.g. deviva.app's interview canvas).
 */
export { ENGINE_VERSION } from "@deviva-draw/engine";

export type { TextEditorOverlayProps } from "./components/text-editor-overlay";
export { TextEditorOverlay } from "./components/text-editor-overlay";

export type { TextEditingOverlay, UseTextEditingOptions } from "./hooks/use-text-editing";
export { useTextEditing } from "./hooks/use-text-editing";

export { shouldCommitOnEnter } from "./hooks/should-commit-on-enter";

export type { MimeTyped } from "./hooks/clipboard-image-detection";
export { findFirstImageItem, isImageMimeType, looksLikeSvgMarkup, SVG_MIME_TYPE, svgMarkupToBytes } from "./hooks/clipboard-image-detection";

export type { UsePasteAndDropOptions } from "./hooks/use-paste-and-drop";
export { usePasteAndDrop } from "./hooks/use-paste-and-drop";
