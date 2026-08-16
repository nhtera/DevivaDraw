/**
 * The desktop `FileOperationsProvider`: real paths via the Rust file-I/O commands
 * (`src-tauri/src/file_io.rs`). Every path-based operation is validated Rust-side against the
 * per-path allowlist — this module holds no filesystem capability of its own, it only asks.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { FileOperationsProvider, OpenedFile } from "@deviva-draw/react";

interface WatchEventPayload {
  watchId: string;
  kind: "modified" | "removed";
}

export function createDesktopFileOperations(): FileOperationsProvider {
  return {
    pickFile: (extensions) => invoke<OpenedFile | null>("pick_open_file", { extensions }),
    writeFile: (path, text) => invoke("write_allowed_file", { path, text }),
    pickSavePath: (suggestedName, extensions) => invoke<string | null>("pick_save_path", { suggestedName, extensions }),
    watchFile: (path, onEvent) => {
      const watchId = crypto.randomUUID();
      // Subscribe first, then start the Rust poller — the reverse order can drop the first event.
      const unlisten = listen<WatchEventPayload>("file-external-change", (event) => {
        if (event.payload.watchId === watchId) onEvent(event.payload.kind);
      });
      const started = unlisten.then(() => invoke("watch_allowed_file", { path, watchId }));
      return () => {
        // Chained on `started`, never fired immediately: a disposer racing the deferred watch
        // start would otherwise no-op (nothing registered yet) and orphan the poll thread forever.
        void started.finally(() => invoke("unwatch_file", { watchId }));
        void unlisten.then((dispose) => dispose());
      };
    },
  };
}
