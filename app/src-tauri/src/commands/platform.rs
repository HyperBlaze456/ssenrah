use crate::errors::IpcError;
use crate::platform::detect;
use crate::platform::paths;
use crate::types::PlatformInfo;

/// IPC command: returns information about the host platform.
#[tauri::command]
pub fn get_platform_info() -> Result<PlatformInfo, IpcError> {
    let os = detect::detect_os().to_string();
    let is_wsl = detect::is_wsl();
    let shell = detect::detect_shell();
    let (claude_code_installed, claude_code_path) = detect::detect_claude_code();
    let config_dir = paths::resolve_config_dir()
        .to_string_lossy()
        .to_string();
    let managed_settings_dir = paths::resolve_managed_settings_dir()
        .map(|p| p.to_string_lossy().to_string());

    Ok(PlatformInfo {
        os,
        is_wsl,
        shell,
        claude_code_installed,
        claude_code_path,
        config_dir,
        managed_settings_dir,
    })
}
