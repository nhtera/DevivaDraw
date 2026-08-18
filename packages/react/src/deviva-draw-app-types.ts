/** Public `<DevivaDraw/>` prop surface — split into its own file so both `deviva-draw-app.tsx` (the provider wrapper) and `deviva-draw-shell.tsx` (the composed chrome, which needs the same shape minus `theme`/`locale`, already consumed by the providers) can reference it without a circular value import. */
import type { AnyElement, MultiPageDocumentV1, SceneDocument } from "@deviva-draw/engine";
import type { CSSProperties } from "react";
import type { FileOperationsProvider } from "./browser/file-operations-provider";
import type { LanHostController } from "./browser/lan-host-controller";
import type { DocumentState } from "./runtime/document-state-tracker";
import type { Locale } from "./i18n/locale-storage";
import type { ThemeMode } from "./theme/theme-tokens";

export interface DevivaDrawStoredFile {
  mimeType: string;
  dataURL: string;
  createdAt: number;
}

export interface DevivaDrawProps {
  /** A previously-saved document to load on mount — a single-scene document (`Scene.toJSON()`) or a multi-page one (`serializeMultiPageDocument`); omit to restore from localStorage autosave instead (the standalone-app default). */
  initialData?: SceneDocument | MultiPageDocumentV1 | null;
  /** Scopes the built-in localStorage autosave to this key instead of the package-wide default (`AUTOSAVE_STORAGE_KEY`) — lets an embedding host mount several independent instances (e.g. one per interview session) without one overwriting another's saved scene. Ignored when `initialData` is supplied: an embedder passing its own snapshot is managing persistence itself, and this component must never write to `window.localStorage` under it (see `initialData`'s doc). */
  persistenceKey?: string;
  /** Fired (debounced) after any user-authored scene change — the embedding-host integration point. */
  onChange?(elements: AnyElement[], files: Record<string, DevivaDrawStoredFile>): void;
  /** `"light"`/`"dark"` to force a theme; omit to use the persisted preference, then default to light. */
  theme?: ThemeMode;
  /** `"en"`/`"vi"` to force a language; omit to use the persisted preference, then the browser's own language. */
  locale?: Locale;
  /** Starts the app shell in view-only mode (hides the properties panel/context menu, same as toggling `toggle-view-only`) — the shared-scene viewer route (`SharedSceneViewer`) sets this so an opened share link is a read-only snapshot, never editable in place (live co-editing is a separate, room-based feature, not what opening a share link does). Omit for the normal editable default. */
  initialViewOnly?: boolean;
  /** The collab-server's base URL (e.g. `http://localhost:8788` in dev) — required for the "Share" main-menu action *and* live collaboration (`useCollabSession`, driven by the "Collaborate…" menu action) to work; omit to leave both disabled (each fails gracefully with an inline error rather than attempting a request to nowhere). */
  shareApiBaseUrl?: string;
  /** A full room URL (`.../room/{id}#key=...`) to auto-join once on mount — how a host application turns a shared room link into a live session without the recipient opening the Collaborate dialog and pasting it by hand. Requires `shareApiBaseUrl`; a malformed or keyless URL surfaces the same inline collab error as a manual join. */
  initialRoomUrl?: string;
  /** Host-supplied file operations for scene open/save — how a shell with a real filesystem (the desktop app) provides native dialogs, path identity, and save-in-place. Omit for the browser's picker/download behavior, which is unchanged when this prop is absent. See `FileOperationsProvider`. */
  fileOperations?: FileOperationsProvider;
  /** Fired synchronously on every document identity/dirty transition (`{path, name, dirty}`) — the desktop shell's title bar, macOS documentEdited dot, recents, and unsaved-close guard all hang off this. Dirty is content-only: pan/zoom and page switching never set it. */
  onDocumentStateChange?(state: DocumentState): void;
  /** Lets this editor host a collaboration room on the local network — desktop-only, since hosting means listening on a TCP port. Omit (the browser default) and no hosting UI renders at all. See `browser/lan-host-controller.ts`. */
  lanHost?: LanHostController;
  /** Lets online-only entry points (Share, Collaborate, Mermaid AI) render a "requires internet" hint and disable themselves while `navigator.onLine` is false — set by the desktop shell. Omit (the browser default) and those surfaces render exactly as before, hint code inert. */
  offlineHints?: boolean;
  className?: string;
  style?: CSSProperties;
}
