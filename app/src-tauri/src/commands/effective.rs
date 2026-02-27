use tauri::State;

use crate::errors::IpcError;
use crate::platform::paths;
use crate::schema::merge;
use crate::types::ConfigScope;
use crate::AppState;

/// Reads a settings file for the given scope, returning `None` if the file
/// does not exist. Parse errors and permission errors are propagated.
fn read_scope(
    scope: &ConfigScope,
    project_root: &Option<String>,
) -> Result<Option<serde_json::Value>, IpcError> {
    let path = match paths::resolve_settings_path(scope, project_root) {
        Ok(p) => p,
        // If there is no project open, project/local scopes simply return None.
        Err(IpcError::NoProject { .. }) => return Ok(None),
        // Managed settings dir not supported on this platform -> None.
        Err(IpcError::PlatformError { .. }) => return Ok(None),
        Err(e) => return Err(e),
    };

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

/// IPC command: computes the effective (merged) configuration from all 4 scopes.
///
/// Returns a JSON object with:
/// - `settings`: the merged configuration
/// - `sources`: map of JSON path -> scope name
/// - `overrides`: list of fields where higher scopes override lower scopes
#[tauri::command]
pub fn compute_effective_config(
    state: State<AppState>,
) -> Result<serde_json::Value, IpcError> {
    let project_root = state
        .project_root
        .lock()
        .map_err(|e| IpcError::PlatformError {
            message: format!("Failed to acquire state lock: {}", e),
        })?;

    let user = read_scope(&ConfigScope::User, &project_root)?;
    let project = read_scope(&ConfigScope::Project, &project_root)?;
    let local = read_scope(&ConfigScope::Local, &project_root)?;
    let managed = read_scope(&ConfigScope::Managed, &project_root)?;

    let effective = merge::compute_effective(
        user.as_ref(),
        project.as_ref(),
        local.as_ref(),
        managed.as_ref(),
    );

    // Serialize the EffectiveConfig struct to a JSON Value for the frontend.
    serde_json::to_value(&effective).map_err(|e| IpcError::PlatformError {
        message: format!("Failed to serialize effective config: {}", e),
    })
}
