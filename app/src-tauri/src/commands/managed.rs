use std::fs;

use crate::errors::IpcError;
use crate::platform::paths;

/// IPC command: reads the managed-settings.json file.
///
/// Returns:
/// - `Ok(Some(value))` if the file exists and parses successfully
/// - `Ok(None)` if the file does not exist
/// - `Err(...)` on I/O or parse failure
#[tauri::command]
pub fn read_managed_settings() -> Result<Option<serde_json::Value>, IpcError> {
    let dir = paths::resolve_managed_settings_dir().ok_or_else(|| IpcError::PlatformError {
        message: "Managed settings directory is not supported on this platform.".to_string(),
    })?;

    let path = dir.join("managed-settings.json");
    let path_str = path.to_string_lossy().to_string();

    match fs::read_to_string(&path) {
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
