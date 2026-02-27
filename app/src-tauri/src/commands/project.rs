use std::path::Path;

use tauri::State;

use crate::errors::IpcError;
use crate::types::ProjectInfo;
use crate::AppState;

/// IPC command: returns the current project info from managed state.
#[tauri::command]
pub fn get_project_info(state: State<AppState>) -> Result<ProjectInfo, IpcError> {
    let project_root = state
        .project_root
        .lock()
        .map_err(|e| IpcError::PlatformError {
            message: format!("Failed to acquire state lock: {}", e),
        })?;

    match project_root.as_ref() {
        Some(root) => {
            let root_path = Path::new(root);
            let claude_dir_exists = root_path.join(".claude").is_dir();
            let git_root = find_git_root(root_path);

            Ok(ProjectInfo {
                project_root: Some(root.clone()),
                claude_dir_exists,
                git_root,
            })
        }
        None => Ok(ProjectInfo {
            project_root: None,
            claude_dir_exists: false,
            git_root: None,
        }),
    }
}

/// IPC command: opens a project directory.
///
/// Validates that the path exists and is a directory, then stores it in
/// AppState. Returns updated ProjectInfo.
#[tauri::command]
pub fn open_project(path: String, state: State<AppState>) -> Result<ProjectInfo, IpcError> {
    let root_path = Path::new(&path);

    // Validate the path exists and is a directory
    if !root_path.exists() {
        return Err(IpcError::NotFound {
            path: path.clone(),
        });
    }

    if !root_path.is_dir() {
        return Err(IpcError::NotFound {
            path: path.clone(),
        });
    }

    let claude_dir_exists = root_path.join(".claude").is_dir();
    let git_root = find_git_root(root_path);

    // Store the project root in managed state
    let mut project_root = state
        .project_root
        .lock()
        .map_err(|e| IpcError::PlatformError {
            message: format!("Failed to acquire state lock: {}", e),
        })?;
    *project_root = Some(path.clone());

    Ok(ProjectInfo {
        project_root: Some(path),
        claude_dir_exists,
        git_root,
    })
}

/// Walks up from the given path looking for a `.git` directory.
/// Returns the path containing `.git`, or None.
fn find_git_root(start: &Path) -> Option<String> {
    let mut current = start.to_path_buf();
    loop {
        if current.join(".git").exists() {
            return Some(current.to_string_lossy().to_string());
        }
        if !current.pop() {
            return None;
        }
    }
}
