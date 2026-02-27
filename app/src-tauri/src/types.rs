use serde::{Deserialize, Serialize};

/// Scope from which a settings file can be read.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ConfigScope {
    User,
    Project,
    Local,
    Managed,
}

/// Scopes that the GUI is allowed to write to.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WritableScope {
    User,
    Project,
    Local,
}

/// Information about the host platform, resolved at runtime.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlatformInfo {
    pub os: String,
    pub is_wsl: bool,
    pub shell: String,
    pub claude_code_installed: bool,
    pub claude_code_path: Option<String>,
    pub config_dir: String,
    pub managed_settings_dir: Option<String>,
}

/// Information about the currently-opened project.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInfo {
    pub project_root: Option<String>,
    pub claude_dir_exists: bool,
    pub git_root: Option<String>,
}

/// A single validation error, surfaced to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ValidationError {
    pub path: String,
    pub message: String,
    pub code: String,
}

/// A single validation warning, surfaced to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ValidationWarning {
    pub path: String,
    pub message: String,
    pub code: String,
}
