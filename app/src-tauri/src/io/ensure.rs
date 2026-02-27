use crate::errors::IpcError;
use crate::AppState;
use std::fs;
use std::path::Path;
use tauri::State;

#[tauri::command]
pub fn ensure_claude_dir(state: State<AppState>) -> Result<(), IpcError> {
    let project_root = state.project_root.lock().unwrap();
    let root = project_root.as_ref().ok_or_else(|| IpcError::NoProject {
        message: "No project open".to_string(),
    })?;

    let claude_dir = Path::new(root).join(".claude");
    if !claude_dir.exists() {
        fs::create_dir_all(&claude_dir).map_err(|e| IpcError::WriteFailed {
            path: claude_dir.display().to_string(),
            message: format!("Failed to create .claude directory: {}", e),
        })?;
    }

    Ok(())
}
