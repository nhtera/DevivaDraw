//! Path-allowlisted file I/O for the desktop shell.
//!
//! There is deliberately NO JS-side `fs` capability in this app: a broad grant would hand any
//! WebView compromise the user's home directory, and dialog-scoped runtime grants can't serve
//! file-association/recent-files opens (no dialog is involved and grants don't persist across
//! launches). Instead, every path-based read/write goes through Rust commands (added in the
//! file-ops phase) that validate the target against this explicit allowlist first.
//!
//! Paths enter the allowlist only through trusted, user-initiated moments: a native open/save
//! dialog choice, a file-association launch argument, or a recent-files entry the app itself
//! persisted. The app-data directory gets a standing grant when the document-lifecycle phase
//! lands recents/crash-recovery (nothing reads or writes it yet).

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;

/// Mirrors the engine's `DOCUMENT_CEILINGS.maxDocumentBytes` (packages/engine scene-validation) —
/// the on-disk pre-check so a 2GB file is refused before a read even starts.
const MAX_DOCUMENT_BYTES: u64 = 50 * 1024 * 1024;

/// Managed state: the set of absolute paths the WebView may ask Rust to read/write.
#[derive(Default)]
pub struct AllowedPaths(Mutex<HashSet<PathBuf>>);

/// Resolve symlinks and `..` segments before any allowlist comparison — `Path::starts_with`
/// compares raw components, so an unresolved `granted/dir/../../etc/passwd` would otherwise pass.
/// A not-yet-existing file (save-as target) canonicalizes through its parent directory instead.
fn canonical(path: &Path) -> Option<PathBuf> {
    if let Ok(resolved) = std::fs::canonicalize(path) {
        return Some(resolved);
    }
    let parent = std::fs::canonicalize(path.parent()?).ok()?;
    Some(parent.join(path.file_name()?))
}

impl AllowedPaths {
    pub fn grant(&self, path: PathBuf) {
        let entry = canonical(&path).unwrap_or(path);
        self.0.lock().expect("allowlist poisoned").insert(entry);
    }

    /// A path is allowed if it was granted directly, or sits inside a granted directory
    /// (a save-as grant covers the chosen file's parent dir). Paths that cannot be
    /// canonicalized (missing parent, dangling symlink) are denied outright.
    pub fn is_allowed(&self, path: &Path) -> bool {
        let Some(resolved) = canonical(path) else { return false };
        let set = self.0.lock().expect("allowlist poisoned");
        set.iter().any(|granted| resolved == *granted || resolved.starts_with(granted))
    }
}

/// Live external-change watchers keyed by the frontend's watch id — each holds the stop flag its
/// poll thread checks. Registered as managed state alongside `AllowedPaths`.
#[derive(Default)]
pub struct WatchRegistry(Mutex<HashMap<String, Arc<AtomicBool>>>);

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PickedFile {
    path: String,
    name: String,
    text: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct WatchEvent {
    watch_id: String,
    kind: &'static str,
}

fn file_name_of(path: &Path) -> String {
    path.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_else(|| path.to_string_lossy().into_owned())
}

/// Dot-prefixed UI extensions (".devivadraw") → the bare form the dialog filter wants.
fn bare_extensions(extensions: &[String]) -> Vec<String> {
    extensions.iter().map(|ext| ext.trim_start_matches('.').to_string()).collect()
}

/// The dialog filter API wants `&[&str]`; build one from owned strings at the call site.
fn as_str_slice(extensions: &[String]) -> Vec<&str> {
    extensions.iter().map(String::as_str).collect()
}

fn deny(path: &Path) -> String {
    format!("path is not on the granted allowlist: {}", path.display())
}

/// Native open dialog → size pre-check → read → allowlist grant. `None` = user canceled.
/// The blocking dialog runs on a blocking-pool thread — never the main thread.
#[tauri::command]
pub async fn pick_open_file(app: AppHandle, extensions: Vec<String>) -> Result<Option<PickedFile>, String> {
    let bare = bare_extensions(&extensions);
    let dialog = app.dialog().file().add_filter("Deviva Draw", &as_str_slice(&bare));
    let picked = tauri::async_runtime::spawn_blocking(move || dialog.blocking_pick_file())
        .await
        .map_err(|error| error.to_string())?;
    let Some(file_path) = picked else { return Ok(None) };
    let path = file_path.into_path().map_err(|error| error.to_string())?;

    let metadata = std::fs::metadata(&path).map_err(|error| format!("cannot stat {}: {error}", path.display()))?;
    if metadata.len() > MAX_DOCUMENT_BYTES {
        return Err(format!("{} is {} bytes — over the {MAX_DOCUMENT_BYTES}-byte document ceiling", path.display(), metadata.len()));
    }
    let text = std::fs::read_to_string(&path).map_err(|error| format!("cannot read {}: {error}", path.display()))?;
    let name = file_name_of(&path);
    app.state::<AllowedPaths>().grant(path.clone());
    Ok(Some(PickedFile { path: path.to_string_lossy().into_owned(), name, text }))
}

/// Native save dialog → allowlist grant of the chosen path. `None` = user canceled.
#[tauri::command]
pub async fn pick_save_path(app: AppHandle, suggested_name: String, extensions: Vec<String>) -> Result<Option<String>, String> {
    let bare = bare_extensions(&extensions);
    let dialog = app.dialog().file().set_file_name(&suggested_name).add_filter("Deviva Draw", &as_str_slice(&bare));
    let picked = tauri::async_runtime::spawn_blocking(move || dialog.blocking_save_file())
        .await
        .map_err(|error| error.to_string())?;
    let Some(file_path) = picked else { return Ok(None) };
    let path = file_path.into_path().map_err(|error| error.to_string())?;
    app.state::<AllowedPaths>().grant(path.clone());
    Ok(Some(path.to_string_lossy().into_owned()))
}

/// Allowlist-validated read (file-association/recents relaunches re-read without a dialog).
#[tauri::command]
pub fn read_allowed_file(allowed: State<'_, AllowedPaths>, path: String) -> Result<String, String> {
    let path = PathBuf::from(path);
    if !allowed.is_allowed(&path) {
        return Err(deny(&path));
    }
    let metadata = std::fs::metadata(&path).map_err(|error| format!("cannot stat {}: {error}", path.display()))?;
    if metadata.len() > MAX_DOCUMENT_BYTES {
        return Err(format!("{} is {} bytes — over the {MAX_DOCUMENT_BYTES}-byte document ceiling", path.display(), metadata.len()));
    }
    std::fs::read_to_string(&path).map_err(|error| format!("cannot read {}: {error}", path.display()))
}

/// Allowlist-validated atomic write: temp file in the SAME directory, then rename — a kill
/// mid-write leaves the original untouched (rename is atomic on one volume; a cross-volume temp
/// would silently lose that property, hence same-dir).
#[tauri::command]
pub fn write_allowed_file(allowed: State<'_, AllowedPaths>, path: String, text: String) -> Result<(), String> {
    let path = PathBuf::from(path);
    if !allowed.is_allowed(&path) {
        return Err(deny(&path));
    }
    write_atomic(&path, &text)
}

fn write_atomic(path: &Path, text: &str) -> Result<(), String> {
    let parent = path.parent().ok_or_else(|| format!("{} has no parent directory", path.display()))?;
    let nanos = SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).map(|d| d.subsec_nanos()).unwrap_or(0);
    let temp = parent.join(format!(".{}.tmp-{}-{nanos}", file_name_of(path), std::process::id()));
    std::fs::write(&temp, text).map_err(|error| {
        let _ = std::fs::remove_file(&temp);
        format!("cannot write temp file {}: {error}", temp.display())
    })?;
    std::fs::rename(&temp, path).map_err(|error| {
        let _ = std::fs::remove_file(&temp);
        format!("cannot move temp file into place at {}: {error}", path.display())
    })
}

/// Polls an allowed path for external modification/removal, emitting `file-external-change`
/// events tagged with `watch_id`. Polling (not an OS watcher) on purpose: zero native deps, and
/// the agent-integration requirement is "external edit visible ≤2s" — a 700ms poll clears that.
#[tauri::command]
pub fn watch_allowed_file(app: AppHandle, allowed: State<'_, AllowedPaths>, watches: State<'_, WatchRegistry>, path: String, watch_id: String) -> Result<(), String> {
    let path = PathBuf::from(path);
    if !allowed.is_allowed(&path) {
        return Err(deny(&path));
    }
    let stop = Arc::new(AtomicBool::new(false));
    watches.0.lock().expect("watch registry poisoned").insert(watch_id.clone(), Arc::clone(&stop));

    std::thread::spawn(move || {
        let mtime_of = |p: &Path| std::fs::metadata(p).and_then(|m| m.modified()).ok();
        let mut last = mtime_of(&path);
        let mut present = last.is_some() || path.exists();
        while !stop.load(Ordering::Relaxed) {
            std::thread::sleep(Duration::from_millis(700));
            if stop.load(Ordering::Relaxed) {
                break;
            }
            let now_mtime = mtime_of(&path);
            let now_present = now_mtime.is_some() || path.exists();
            if present && !now_present {
                let _ = app.emit("file-external-change", WatchEvent { watch_id: watch_id.clone(), kind: "removed" });
            } else if now_present && now_mtime != last && now_mtime.is_some() {
                let _ = app.emit("file-external-change", WatchEvent { watch_id: watch_id.clone(), kind: "modified" });
            }
            last = now_mtime;
            present = now_present;
        }
    });
    Ok(())
}

/// Stops the poll thread behind `watch_id`; idempotent (an unknown id is a no-op).
#[tauri::command]
pub fn unwatch_file(watches: State<'_, WatchRegistry>, watch_id: String) {
    if let Some(stop) = watches.0.lock().expect("watch registry poisoned").remove(&watch_id) {
        stop.store(true, Ordering::Relaxed);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allowlist_denies_untracked_and_traversal_paths() {
        let allowed = AllowedPaths::default();
        let dir = std::env::temp_dir().join(format!("dd-allow-test-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("inner")).unwrap();
        std::fs::write(dir.join("inner/doc.devivadraw"), "{}").unwrap();
        allowed.grant(dir.join("inner"));

        assert!(allowed.is_allowed(&dir.join("inner/doc.devivadraw")));
        // Unresolved `..` escaping the grant must not pass (canonicalization catches it).
        assert!(!allowed.is_allowed(&dir.join("inner/../outside.txt")));
        assert!(!allowed.is_allowed(Path::new("/etc/hosts")));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn atomic_write_replaces_content_and_leaves_no_temp() {
        let dir = std::env::temp_dir().join(format!("dd-write-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let target = dir.join("doc.devivadraw");
        std::fs::write(&target, "old").unwrap();

        write_atomic(&target, "new-content").unwrap();
        assert_eq!(std::fs::read_to_string(&target).unwrap(), "new-content");
        let leftovers: Vec<_> = std::fs::read_dir(&dir).unwrap().filter_map(Result::ok).filter(|e| e.file_name().to_string_lossy().contains(".tmp-")).collect();
        assert!(leftovers.is_empty(), "temp file leaked: {leftovers:?}");
        std::fs::remove_dir_all(&dir).ok();
    }
}
