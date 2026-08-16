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
//! persisted. The app-data directory is always allowed (recents index, crash-recovery scratch).

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

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

// Consumed by the file-ops phase's commands; managed state is registered now so the
// security model is in place from the first shipped shell.
#[allow(dead_code)]
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
