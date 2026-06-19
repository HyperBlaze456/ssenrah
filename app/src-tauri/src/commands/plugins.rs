use std::fs;
use std::path::{Path, PathBuf};

use crate::errors::IpcError;
use crate::io::atomic::atomic_write;
use crate::platform::paths;

/// Resolves the plugins directory under the Claude config dir.
///
/// {configDir}/plugins/
fn plugins_dir() -> PathBuf {
    paths::resolve_config_dir().join("plugins")
}

fn installed_plugins_path() -> PathBuf {
    plugins_dir().join("installed_plugins.json")
}

fn known_marketplaces_path() -> PathBuf {
    plugins_dir().join("known_marketplaces.json")
}

/// Reads a JSON file and returns its contents, or None if it doesn't exist.
fn read_json_file(path: &Path) -> Result<Option<serde_json::Value>, IpcError> {
    let path_str = path.to_string_lossy().to_string();
    match fs::read_to_string(path) {
        Ok(contents) => {
            let value: serde_json::Value =
                serde_json::from_str(&contents).map_err(|e| IpcError::ParseError {
                    path: path_str.clone(),
                    message: e.to_string(),
                })?;
            Ok(Some(value))
        }
        Err(e) => match e.kind() {
            std::io::ErrorKind::NotFound => Ok(None),
            std::io::ErrorKind::PermissionDenied => Err(IpcError::PermissionDenied {
                path: path_str,
            }),
            _ => Err(IpcError::PlatformError {
                message: format!("Failed to read {}: {}", path_str, e),
            }),
        },
    }
}

fn write_json_file(path: &Path, value: &serde_json::Value) -> Result<(), IpcError> {
    let path_str = path.display().to_string();

    if let Some(parent) = path.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent).map_err(|e| IpcError::WriteFailed {
                path: path_str.clone(),
                message: format!("Failed to create parent directory: {}", e),
            })?;
        }
    }

    let content = serde_json::to_vec_pretty(value).map_err(|e| IpcError::WriteFailed {
        path: path_str.clone(),
        message: format!("Failed to serialize: {}", e),
    })?;

    atomic_write(path, &content)
}

/// Best-effort recursive directory removal. Errors are swallowed because
/// the registry edit is the source of truth — a leftover cache directory
/// is recoverable; a registry that disagrees with disk is not.
fn try_remove_dir_all(path: &Path) {
    if path.exists() {
        let _ = fs::remove_dir_all(path);
    }
}

/// IPC command: reads `~/.claude/plugins/installed_plugins.json`.
///
/// Shape:
/// ```json
/// {
///   "version": 2,
///   "plugins": {
///     "<plugin>@<marketplace>": [{ "scope": "user", "installPath": "...", ... }]
///   }
/// }
/// ```
#[tauri::command]
pub fn read_installed_plugins() -> Result<Option<serde_json::Value>, IpcError> {
    read_json_file(&installed_plugins_path())
}

/// IPC command: reads `~/.claude/plugins/known_marketplaces.json`.
///
/// Shape: `{ "<name>": { "source": {...}, "installLocation": "...", ... } }`
#[tauri::command]
pub fn read_known_marketplaces() -> Result<Option<serde_json::Value>, IpcError> {
    read_json_file(&known_marketplaces_path())
}

/// IPC command: removes a plugin from `installed_plugins.json` and best-effort
/// deletes its install directory.
///
/// `plugin_id` is the registry key (e.g. `"ouroboros@ouroboros"`).
/// If `scope` is provided, only entries matching that scope are removed; if
/// the resulting list is empty, the plugin key is dropped entirely.
#[tauri::command]
pub fn remove_installed_plugin(
    plugin_id: String,
    scope: Option<String>,
) -> Result<(), IpcError> {
    let path = installed_plugins_path();

    let existing = match read_json_file(&path)? {
        Some(v) => v,
        None => return Ok(()),
    };

    let mut root = match existing {
        serde_json::Value::Object(m) => m,
        _ => {
            return Err(IpcError::ParseError {
                path: path.display().to_string(),
                message: "installed_plugins.json is not a JSON object".to_string(),
            });
        }
    };

    let mut paths_to_remove: Vec<PathBuf> = Vec::new();

    if let Some(serde_json::Value::Object(plugins)) = root.get_mut("plugins") {
        let entries = plugins.remove(&plugin_id);
        if let Some(serde_json::Value::Array(arr)) = entries {
            let (matching, remaining): (Vec<_>, Vec<_>) =
                arr.into_iter().partition(|entry| match (&scope, entry) {
                    (Some(s), serde_json::Value::Object(obj)) => obj
                        .get("scope")
                        .and_then(|v| v.as_str())
                        .map_or(false, |entry_scope| entry_scope == s),
                    (None, _) => true,
                    _ => false,
                });

            for entry in &matching {
                if let Some(install_path) = entry
                    .as_object()
                    .and_then(|o| o.get("installPath"))
                    .and_then(|v| v.as_str())
                {
                    paths_to_remove.push(PathBuf::from(install_path));
                }
            }

            if !remaining.is_empty() {
                plugins.insert(plugin_id.clone(), serde_json::Value::Array(remaining));
            }
        }
    }

    write_json_file(&path, &serde_json::Value::Object(root))?;

    for p in paths_to_remove {
        try_remove_dir_all(&p);
    }

    Ok(())
}

/// IPC command: removes a marketplace from `known_marketplaces.json` and
/// best-effort deletes its install location.
#[tauri::command]
pub fn remove_known_marketplace(name: String) -> Result<(), IpcError> {
    let path = known_marketplaces_path();

    let existing = match read_json_file(&path)? {
        Some(v) => v,
        None => return Ok(()),
    };

    let mut root = match existing {
        serde_json::Value::Object(m) => m,
        _ => {
            return Err(IpcError::ParseError {
                path: path.display().to_string(),
                message: "known_marketplaces.json is not a JSON object".to_string(),
            });
        }
    };

    let removed = root.remove(&name);

    write_json_file(&path, &serde_json::Value::Object(root))?;

    if let Some(serde_json::Value::Object(entry)) = removed {
        if let Some(install_location) = entry.get("installLocation").and_then(|v| v.as_str()) {
            try_remove_dir_all(&PathBuf::from(install_location));
        }
    }

    Ok(())
}
