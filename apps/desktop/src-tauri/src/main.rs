// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod file_io;

use tauri::{WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
use tauri_plugin_opener::OpenerExt;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(file_io::AllowedPaths::default())
        .manage(file_io::WatchRegistry::default())
        .invoke_handler(tauri::generate_handler![
            file_io::pick_open_file,
            file_io::pick_save_path,
            file_io::read_allowed_file,
            file_io::write_allowed_file,
            file_io::watch_allowed_file,
            file_io::unwatch_file,
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            // The window is built here (not declared in tauri.conf.json) because the navigation
            // policy below is only attachable at build time. Tauri's drag-drop interception stays
            // at its default (enabled): it is the only source of real OS file paths, and the
            // document-open bridge listens for the shell's drag-drop events, not DOM drops.
            WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                .title("Deviva Draw")
                .inner_size(1440.0, 900.0)
                .min_inner_size(800.0, 600.0)
                // `on_navigation` does not fire for `window.open`/`target="_blank"` — Tauri would
                // open those in the system browser silently, bypassing the confirm flow below. The
                // editor's link affordances all use `_blank`, so rewrite them into same-window
                // navigations here; `on_navigation` then intercepts every external URL uniformly.
                .initialization_script(
                    r#"(() => {
                      const nav = (url) => { try { location.href = String(url); } catch {} };
                      window.open = (url) => { if (url) nav(url); return null; };
                      document.addEventListener("click", (e) => {
                        const a = e.target && e.target.closest && e.target.closest('a[target="_blank"]');
                        if (a && a.href) { e.preventDefault(); nav(a.href); }
                      }, true);
                    })();"#,
                )
                // The WebView never navigates off the app origin. External links get a
                // confirm-then-open-in-system-browser flow; everything else is dropped.
                // The bare-`localhost` arm exists for the vite dev origin only — a release build's
                // own origin is the `tauri:` scheme (macOS/Linux) or `tauri.localhost` (Windows),
                // so links to arbitrary local services must not slip through silently in prod.
                .on_navigation(move |url| {
                    let host = url.host_str().unwrap_or("");
                    if url.scheme() == "tauri"
                        || host == "tauri.localhost"
                        || (cfg!(debug_assertions) && host == "localhost")
                    {
                        return true;
                    }
                    if matches!(url.scheme(), "http" | "https" | "mailto") {
                        let target = url.to_string();
                        let open = handle.clone();
                        handle
                            .dialog()
                            .message(format!("Open this link in your browser?\n\n{target}"))
                            .title("Open external link")
                            .buttons(MessageDialogButtons::OkCancelCustom("Open".into(), "Cancel".into()))
                            .show(move |confirmed| {
                                if confirmed {
                                    let _ = open.opener().open_url(target, None::<&str>);
                                }
                            });
                    }
                    false
                })
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Deviva Draw desktop");
}
