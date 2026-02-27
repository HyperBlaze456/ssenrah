use std::fs;
use std::path::Path;

use tauri::State;

use crate::errors::IpcError;
use crate::io::atomic::atomic_write;
use crate::platform::paths;
use crate::types::{ConfigScope, WritableScope};
use crate::AppState;

/// IPC command: reads a settings file for the given scope.
///
/// Returns:
/// - `Ok(Some(value))` if the file exists and parses successfully
/// - `Ok(None)` if the file does not exist
/// - `Err(IpcError::ParseError)` if the file exists but is not valid JSON
/// - `Err(IpcError::PermissionDenied)` if the file cannot be read
#[tauri::command]
pub fn read_settings(
    scope: ConfigScope,
    state: State<AppState>,
) -> Result<Option<serde_json::Value>, IpcError> {
    let project_root = state
        .project_root
        .lock()
        .map_err(|e| IpcError::PlatformError {
            message: format!("Failed to acquire state lock: {}", e),
        })?;

    let path = paths::resolve_settings_path(&scope, &project_root)?;
    let path_str = path.to_string_lossy().to_string();

    match std::fs::read_to_string(&path) {
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

/// IPC command: writes a settings JSON object for the given writable scope.
///
/// Resolves the target path, ensures the parent directory exists, serializes
/// the value to pretty JSON, and performs an atomic write (temp file + rename).
#[tauri::command]
pub fn write_settings(
    scope: WritableScope,
    settings: serde_json::Value,
    state: State<AppState>,
) -> Result<(), IpcError> {
    let project_root = state
        .project_root
        .lock()
        .map_err(|e| IpcError::PlatformError {
            message: format!("Failed to acquire state lock: {}", e),
        })?;

    // Map WritableScope to ConfigScope for path resolution
    let config_scope = match scope {
        WritableScope::User => ConfigScope::User,
        WritableScope::Project => ConfigScope::Project,
        WritableScope::Local => ConfigScope::Local,
    };

    let path = paths::resolve_settings_path(&config_scope, &project_root)?;
    let path_str = path.display().to_string();

    // Ensure parent directory exists
    if let Some(parent) = path.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent).map_err(|e| IpcError::WriteFailed {
                path: path_str.clone(),
                message: format!("Failed to create parent directory: {}", e),
            })?;
        }
    }

    // Serialize to pretty JSON
    let content = serde_json::to_vec_pretty(&settings).map_err(|e| IpcError::WriteFailed {
        path: path_str.clone(),
        message: format!("Failed to serialize settings: {}", e),
    })?;

    // Atomic write
    atomic_write(Path::new(&path), &content)?;

    Ok(())
}
