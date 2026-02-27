use std::path::PathBuf;

use crate::errors::IpcError;
use crate::types::ConfigScope;

/// Returns the user's home directory via the `dirs` crate.
///
/// Panics if the home directory cannot be determined (should not happen on
/// any supported platform).
pub fn home_dir() -> PathBuf {
    dirs::home_dir().expect("could not determine home directory")
}

/// Resolves the Claude Code config directory.
///
/// Priority:
/// 1. CLAUDE_CONFIG_DIR environment variable
/// 2. ~/.claude/
pub fn resolve_config_dir() -> PathBuf {
    if let Ok(dir) = std::env::var("CLAUDE_CONFIG_DIR") {
        if !dir.is_empty() {
            return PathBuf::from(dir);
        }
    }

    home_dir().join(".claude")
}

/// Resolves the managed-settings directory (machine-wide, admin-controlled).
///
/// - macOS:   /Library/Application Support/ClaudeCode/
/// - Linux:   /etc/claude-code/
/// - Windows: None (not yet supported)
pub fn resolve_managed_settings_dir() -> Option<PathBuf> {
    if cfg!(target_os = "macos") {
        Some(PathBuf::from("/Library/Application Support/ClaudeCode"))
    } else if cfg!(target_os = "linux") {
        Some(PathBuf::from("/etc/claude-code"))
    } else {
        // Windows: no managed-settings directory yet
        None
    }
}

/// Resolves the settings file path for a given scope.
///
/// - User:    ~/.claude/settings.json
/// - Project: {projectRoot}/.claude/settings.json
/// - Local:   {projectRoot}/.claude/settings.local.json
/// - Managed: {managedSettingsDir}/managed-settings.json
pub fn resolve_settings_path(
    scope: &ConfigScope,
    project_root: &Option<String>,
) -> Result<PathBuf, IpcError> {
    match scope {
        ConfigScope::User => {
            let config_dir = resolve_config_dir();
            Ok(config_dir.join("settings.json"))
        }
        ConfigScope::Project => {
            let root = project_root.as_ref().ok_or_else(|| IpcError::NoProject {
                message: "No project is open. Open a project before reading project settings."
                    .to_string(),
            })?;
            Ok(PathBuf::from(root).join(".claude").join("settings.json"))
        }
        ConfigScope::Local => {
            let root = project_root.as_ref().ok_or_else(|| IpcError::NoProject {
                message: "No project is open. Open a project before reading local settings."
                    .to_string(),
            })?;
            Ok(PathBuf::from(root)
                .join(".claude")
                .join("settings.local.json"))
        }
        ConfigScope::Managed => {
            let dir = resolve_managed_settings_dir().ok_or_else(|| IpcError::PlatformError {
                message: "Managed settings directory is not supported on this platform."
                    .to_string(),
            })?;
            Ok(dir.join("managed-settings.json"))
        }
    }
}
