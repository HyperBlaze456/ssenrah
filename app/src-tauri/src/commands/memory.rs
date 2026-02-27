use std::fs;
use std::path::{Path, PathBuf};

use tauri::State;

use crate::errors::IpcError;
use crate::io::atomic::atomic_write;
use crate::platform::paths;
use crate::AppState;

/// Resolves the file path for a given memory scope.
///
/// - "user"         -> {configDir}/CLAUDE.md
/// - "project"      -> {projectRoot}/.claude/CLAUDE.md
/// - "project_root" -> {projectRoot}/CLAUDE.md
/// - "local"        -> {projectRoot}/.claude/CLAUDE.local.md
fn resolve_memory_path(scope: &str, project_root: &Option<String>) -> Result<PathBuf, IpcError> {
    match scope {
        "user" => {
            let config_dir = paths::resolve_config_dir();
            Ok(config_dir.join("CLAUDE.md"))
        }
        "project" => {
            let root = project_root.as_ref().ok_or_else(|| IpcError::NoProject {
                message: "No project is open. Open a project before reading project memory."
                    .to_string(),
            })?;
            Ok(PathBuf::from(root).join(".claude").join("CLAUDE.md"))
        }
        "project_root" => {
            let root = project_root.as_ref().ok_or_else(|| IpcError::NoProject {
                message: "No project is open. Open a project before reading project root memory."
                    .to_string(),
            })?;
            Ok(PathBuf::from(root).join("CLAUDE.md"))
        }
        "local" => {
            let root = project_root.as_ref().ok_or_else(|| IpcError::NoProject {
                message: "No project is open. Open a project before reading local memory."
                    .to_string(),
            })?;
            Ok(PathBuf::from(root).join(".claude").join("CLAUDE.local.md"))
        }
        _ => Err(IpcError::PlatformError {
            message: format!("Unknown memory scope: {}", scope),
        }),
    }
}

/// IPC command: reads a memory file (CLAUDE.md) for the given scope.
///
/// Returns `Ok(Some(content))` if the file exists, `Ok(None)` if it does not.
#[tauri::command]
pub fn read_memory(scope: String, state: State<AppState>) -> Result<Option<String>, IpcError> {
    let project_root = state
        .project_root
        .lock()
        .map_err(|e| IpcError::PlatformError {
            message: format!("Failed to acquire state lock: {}", e),
        })?;

    let path = resolve_memory_path(&scope, &project_root)?;

    match fs::read_to_string(&path) {
        Ok(content) => Ok(Some(content)),
        Err(e) => match e.kind() {
            std::io::ErrorKind::NotFound => Ok(None),
            std::io::ErrorKind::PermissionDenied => Err(IpcError::PermissionDenied {
                path: path.display().to_string(),
            }),
            _ => Err(IpcError::PlatformError {
                message: format!("Failed to read {}: {}", path.display(), e),
            }),
        },
    }
}

/// IPC command: writes a memory file (CLAUDE.md) for the given scope.
///
/// Creates parent directories if needed and performs an atomic write.
#[tauri::command]
pub fn write_memory(
    scope: String,
    content: String,
    state: State<AppState>,
) -> Result<(), IpcError> {
    let project_root = state
        .project_root
        .lock()
        .map_err(|e| IpcError::PlatformError {
            message: format!("Failed to acquire state lock: {}", e),
        })?;

    let path = resolve_memory_path(&scope, &project_root)?;
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

    atomic_write(Path::new(&path), content.as_bytes())?;

    Ok(())
}
