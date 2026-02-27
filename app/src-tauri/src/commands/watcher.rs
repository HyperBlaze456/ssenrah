use crate::errors::IpcError;
use crate::platform::paths;
use crate::watcher::debounce::DebouncedWatcher;
use crate::AppState;
use std::sync::Mutex;
use tauri::State;

pub struct WatcherState {
    pub watcher: Mutex<Option<DebouncedWatcher>>,
}

#[tauri::command]
pub fn subscribe_file_changes(
    app: tauri::AppHandle,
    state: State<AppState>,
    watcher_state: State<WatcherState>,
) -> Result<(), IpcError> {
    let mut watcher_guard = watcher_state.watcher.lock().unwrap();

    let mut watcher = DebouncedWatcher::new(app).map_err(|e| IpcError::PlatformError {
        message: format!("Failed to create file watcher: {}", e),
    })?;

    // Watch user config dir
    let config_dir = paths::resolve_config_dir();
    if config_dir.exists() {
        let _ = watcher.watch(&config_dir);
    }

    // Watch user .claude.json
    let home = paths::home_dir();
    let claude_json = home.join(".claude.json");
    if claude_json.exists() {
        let _ = watcher.watch(&claude_json);
    }

    // Watch project paths if project is open
    let project_root = state.project_root.lock().unwrap();
    if let Some(ref root) = *project_root {
        let claude_dir = std::path::Path::new(root).join(".claude");
        if claude_dir.exists() {
            let _ = watcher.watch_recursive(&claude_dir);
        }
        // Watch project root CLAUDE.md
        let project_claude_md = std::path::Path::new(root).join("CLAUDE.md");
        if project_claude_md.exists() {
            let _ = watcher.watch(&project_claude_md);
        }
    }

    *watcher_guard = Some(watcher);
    Ok(())
}

#[tauri::command]
pub fn unsubscribe_file_changes(
    watcher_state: State<WatcherState>,
) -> Result<(), IpcError> {
    let mut watcher_guard = watcher_state.watcher.lock().unwrap();
    *watcher_guard = None; // Drop watcher, stops watching
    Ok(())
}
