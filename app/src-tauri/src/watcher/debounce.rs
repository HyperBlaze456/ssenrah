use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::AppHandle;
use tauri::Emitter;

pub struct DebouncedWatcher {
    watcher: RecommendedWatcher,
    self_writes: Arc<Mutex<HashMap<PathBuf, Instant>>>,
}

impl DebouncedWatcher {
    pub fn new(app: AppHandle) -> Result<Self, notify::Error> {
        let self_writes: Arc<Mutex<HashMap<PathBuf, Instant>>> =
            Arc::new(Mutex::new(HashMap::new()));
        let sw = self_writes.clone();

        let watcher =
            notify::recommended_watcher(move |res: Result<Event, notify::Error>| {
                if let Ok(event) = res {
                    // Check self-write filter
                    let sw = sw.lock().unwrap();
                    for path in &event.paths {
                        if let Some(time) = sw.get(path) {
                            if time.elapsed() < Duration::from_millis(200) {
                                return; // suppress self-write event
                            }
                        }
                    }
                    drop(sw);

                    let kind = match event.kind {
                        EventKind::Create(_) => "created",
                        EventKind::Modify(_) => "modified",
                        EventKind::Remove(_) => "deleted",
                        _ => return,
                    };

                    for path in &event.paths {
                        let scope = detect_scope(path);
                        let _ = app.emit(
                            "file_change",
                            serde_json::json!({
                                "path": path.display().to_string(),
                                "kind": kind,
                                "scope": scope,
                            }),
                        );
                    }
                }
            })?;

        Ok(Self {
            watcher,
            self_writes,
        })
    }

    pub fn watch(&mut self, path: &std::path::Path) -> Result<(), notify::Error> {
        self.watcher.watch(path, RecursiveMode::NonRecursive)
    }

    pub fn watch_recursive(&mut self, path: &std::path::Path) -> Result<(), notify::Error> {
        self.watcher.watch(path, RecursiveMode::Recursive)
    }

    pub fn record_self_write(&self, path: PathBuf) {
        let mut sw = self.self_writes.lock().unwrap();
        sw.insert(path, Instant::now());
    }
}

fn detect_scope(path: &std::path::Path) -> &'static str {
    let path_str = path.display().to_string();
    if path_str.contains("settings.local.json") || path_str.contains("CLAUDE.local.md") {
        "local"
    } else if path_str.contains(".claude/") || path_str.contains(".claude\\") {
        "project"
    } else if path_str.contains("managed") {
        "managed"
    } else {
        "user"
    }
}
