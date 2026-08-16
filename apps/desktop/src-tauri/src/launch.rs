//! External document opens — file association (double-click / "Open With"), launch arguments,
//! second-instance forwarding, and OS drag-drop onto the window. All four converge on one flow:
//! validate the path (extension allowlist, canonical regular file, size ceiling), grant it in the
//! file-I/O allowlist, read it, and hand a `PickedFile` to the frontend — buffered until the
//! frontend says it is ready (`frontend_ready`), because an event fired during boot has no
//! listener yet (the cold-launch race the plan calls out).

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager, State};

use crate::file_io::{read_openable, AllowedPaths, PickedFile};

/// Extensions an external open may carry — mirrors the frontend's `OPENABLE_EXTENSIONS`.
const OPENABLE_EXTENSIONS: [&str; 2] = ["devivadraw", "excalidraw"];

/// Event the frontend listens on for warm opens (second instance, drag-drop, file-assoc while running).
const OPEN_EVENT: &str = "open-file-request";

#[derive(Default)]
pub struct PendingOpens {
    files: Mutex<Vec<PickedFile>>,
    frontend_ready: AtomicBool,
}

fn has_openable_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| OPENABLE_EXTENSIONS.iter().any(|allowed| ext.eq_ignore_ascii_case(allowed)))
}

/// Validate + grant + read an externally-delivered path. `None` (with a log line) for anything
/// that fails validation — external opens are untrusted input, silently ignoring garbage beats
/// crashing the boot path.
fn pick_external(app: &AppHandle, path: &Path) -> Option<PickedFile> {
    if !has_openable_extension(path) {
        eprintln!("open request ignored (extension): {}", path.display());
        return None;
    }
    // Symlink-resolve before the regular-file check so a link to a directory/device is caught.
    let resolved = match std::fs::canonicalize(path) {
        Ok(resolved) => resolved,
        Err(error) => {
            eprintln!("open request ignored (cannot resolve {}): {error}", path.display());
            return None;
        }
    };
    if !resolved.is_file() {
        eprintln!("open request ignored (not a regular file): {}", path.display());
        return None;
    }
    match read_openable(app.state::<AllowedPaths>(), &resolved) {
        Ok(picked) => Some(picked),
        Err(error) => {
            eprintln!("open request failed for {}: {error}", path.display());
            None
        }
    }
}

/// Image types the drop bridge forwards — with Tauri's drag-drop interception on, DOM file drops
/// never fire, so without this an image dragged onto the desktop canvas would be a silent no-op
/// (web parity gap flagged in the document-lifecycle phase).
const IMAGE_EXTENSIONS: [(&str, &str); 7] = [
    ("png", "image/png"),
    ("jpg", "image/jpeg"),
    ("jpeg", "image/jpeg"),
    ("gif", "image/gif"),
    ("webp", "image/webp"),
    ("svg", "image/svg+xml"),
    ("bmp", "image/bmp"),
];

/// Raw-image cap for the drop bridge — comfortably under the engine's 20M-char dataURL ceiling
/// (base64 inflates ~4/3).
const MAX_DROPPED_IMAGE_BYTES: u64 = 14 * 1024 * 1024;

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DroppedImage {
    name: String,
    mime_type: &'static str,
    data_base64: String,
    x: f64,
    y: f64,
}

fn image_mime_of(path: &Path) -> Option<&'static str> {
    let ext = path.extension()?.to_str()?;
    IMAGE_EXTENSIONS.iter().find(|(known, _)| ext.eq_ignore_ascii_case(known)).map(|(_, mime)| *mime)
}

pub fn is_image_path(path: &Path) -> bool {
    image_mime_of(path).is_some()
}

/// OS drag-drop dispatch: document files go through the normal open flow; images are forwarded as
/// bytes for the frontend to re-dispatch through the editor's own DOM drop pipeline (no allowlist
/// grant — the file is read once here, never re-readable by path from the WebView).
/// The CALLER forwards at most one image per OS drop — the web pipeline inserts one image per drop
/// event, and N separate synthetic drops at the same cursor position would stack N overlapping
/// copies web users would never get.
pub fn deliver_drop(app: &AppHandle, path: &Path, x: f64, y: f64) {
    if let Some(mime_type) = image_mime_of(path) {
        match std::fs::metadata(path) {
            Ok(metadata) if metadata.len() <= MAX_DROPPED_IMAGE_BYTES => {}
            Ok(metadata) => {
                eprintln!("image drop ignored ({} bytes over cap): {}", metadata.len(), path.display());
                return;
            }
            Err(error) => {
                eprintln!("image drop ignored (cannot stat {}): {error}", path.display());
                return;
            }
        }
        match std::fs::read(path) {
            Ok(bytes) => {
                use base64::Engine;
                let payload = DroppedImage {
                    name: path.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_else(|| "image".into()),
                    mime_type,
                    data_base64: base64::engine::general_purpose::STANDARD.encode(bytes),
                    x,
                    y,
                };
                let _ = app.emit("insert-image-request", payload);
            }
            Err(error) => eprintln!("image drop ignored (cannot read {}): {error}", path.display()),
        }
        return;
    }
    deliver(app, path);
}

/// Deliver an external open: emit when the frontend is listening, buffer otherwise.
pub fn deliver(app: &AppHandle, path: &Path) {
    let Some(picked) = pick_external(app, path) else { return };
    let pending = app.state::<PendingOpens>();
    if pending.frontend_ready.load(Ordering::SeqCst) {
        let _ = app.emit(OPEN_EVENT, picked);
    } else {
        pending.files.lock().expect("pending opens poisoned").push(picked);
    }
}

/// Cold-launch arguments (Windows/Linux file association; also plain `app file.devivadraw`).
/// macOS delivers association opens via `RunEvent::Opened` instead — see `main.rs`.
pub fn deliver_argv<I: IntoIterator<Item = String>>(app: &AppHandle, args: I) {
    for arg in args {
        if arg.starts_with('-') {
            continue;
        }
        let path = PathBuf::from(&arg);
        if path.is_absolute() || path.exists() {
            deliver(app, &path);
        }
    }
}

/// Frontend handshake: flips to event-delivery mode and drains everything buffered during boot.
#[tauri::command]
pub fn frontend_ready(pending: State<'_, PendingOpens>) -> Vec<PickedFile> {
    pending.frontend_ready.store(true, Ordering::SeqCst);
    std::mem::take(&mut *pending.files.lock().expect("pending opens poisoned"))
}

/// Caps retained crash-recovery snapshots in app-data (`recovery-*.devivadraw`), pruning oldest
/// first — name-sorted, and the names embed an ISO timestamp, so lexicographic == chronological.
#[tauri::command]
pub fn prune_recovery_files(app: AppHandle, keep: usize) -> Result<(), String> {
    let app_data = app.path().app_data_dir().map_err(|error| error.to_string())?;
    let mut recoveries: Vec<PathBuf> = std::fs::read_dir(&app_data)
        .map_err(|error| error.to_string())?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with("recovery-") && name.ends_with(".devivadraw"))
        })
        .collect();
    recoveries.sort();
    for stale in recoveries.iter().rev().skip(keep) {
        let _ = std::fs::remove_file(stale);
    }
    Ok(())
}

/// Re-grants persisted recents paths at boot so "Open Recent" works across relaunches. The
/// recents index is WebView-writable (it lives in the always-granted app-data dir), so its
/// entries are UNTRUSTED: each one must re-pass the exact validation an external open gets
/// (document extension, symlink-resolved regular file) before any grant — otherwise a one-time
/// WebView compromise could persist arbitrary-path grants across restarts by editing the file.
pub fn grant_recents(app: &AppHandle) {
    let Ok(app_data) = app.path().app_data_dir() else { return };
    let Ok(raw) = std::fs::read_to_string(app_data.join("recents.json")) else { return };
    let Ok(entries) = serde_json::from_str::<Vec<serde_json::Value>>(&raw) else { return };
    let allowed = app.state::<AllowedPaths>();
    for entry in entries {
        let Some(path) = entry.get("path").and_then(|value| value.as_str()) else { continue };
        let path = PathBuf::from(path);
        if !has_openable_extension(&path) {
            eprintln!("recents entry skipped (extension): {}", path.display());
            continue;
        }
        let Ok(resolved) = std::fs::canonicalize(&path) else {
            continue; // moved/deleted — the frontend prunes it on first failed open
        };
        if resolved.is_file() {
            allowed.grant(resolved);
        }
    }
}

/// Three-way unsaved-changes prompt for the close/quit guard. Blocking dialog on a blocking-pool
/// thread; resolves "save" | "discard" | "cancel".
#[tauri::command]
pub async fn prompt_unsaved(app: AppHandle, name: String) -> Result<String, String> {
    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
    let choice = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .message(format!("\"{name}\" has unsaved changes. Save them before closing?"))
            .title("Unsaved Changes")
            .buttons(MessageDialogButtons::YesNoCancelCustom("Save".into(), "Don't Save".into(), "Cancel".into()))
            .blocking_show_with_result()
    })
    .await
    .map_err(|error| error.to_string())?;
    use tauri_plugin_dialog::MessageDialogResult;
    // Custom-labeled buttons report the LABEL (`Custom("Save")`), not Yes/No — match both shapes.
    Ok(match choice {
        MessageDialogResult::Yes => "save".into(),
        MessageDialogResult::No => "discard".into(),
        MessageDialogResult::Custom(label) if label == "Save" => "save".into(),
        MessageDialogResult::Custom(label) if label == "Don't Save" => "discard".into(),
        _ => "cancel".into(),
    })
}
