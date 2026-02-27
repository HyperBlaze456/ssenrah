use std::fs;
use std::path::Path;

use tauri::State;

use crate::errors::IpcError;
use crate::io::atomic::atomic_write;
use crate::platform::paths;
use crate::AppState;

/// Resolves the MCP config file path for a given source.
///
/// - project: {projectRoot}/.claude/.mcp.json
/// - user:    ~/.claude.json (mcpServers section only)
/// - managed: {managedSettingsDir}/managed-mcp.json
fn resolve_mcp_path(
    source: &str,
    project_root: &Option<String>,
) -> Result<std::path::PathBuf, IpcError> {
    match source {
        "project" => {
            let root = project_root.as_ref().ok_or_else(|| IpcError::NoProject {
                message: "No project is open. Open a project before reading project MCP config."
                    .to_string(),
            })?;
            Ok(std::path::PathBuf::from(root)
                .join(".claude")
                .join(".mcp.json"))
        }
        "user" => {
            let home = paths::home_dir();
            Ok(home.join(".claude.json"))
        }
        "managed" => {
            let dir =
                paths::resolve_managed_settings_dir().ok_or_else(|| IpcError::PlatformError {
                    message: "Managed settings directory is not supported on this platform."
                        .to_string(),
                })?;
            Ok(dir.join("managed-mcp.json"))
        }
        _ => Err(IpcError::PlatformError {
            message: format!("Unknown MCP source: {}", source),
        }),
    }
}

/// Reads a JSON file and returns its contents, or None if it doesn't exist.
fn read_json_file(path: &std::path::Path) -> Result<Option<serde_json::Value>, IpcError> {
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

/// IPC command: reads MCP config from the specified source.
///
/// For "user" source, reads ~/.claude.json and extracts the mcpServers key,
/// wrapping it as { mcpServers: ... }. For other sources, reads the file directly.
///
/// Returns:
/// - `Ok(Some(value))` if the file exists and contains MCP config
/// - `Ok(None)` if the file does not exist
/// - `Err(...)` on I/O or parse failure
#[tauri::command]
pub fn read_mcp_config(
    source: String,
    state: State<AppState>,
) -> Result<Option<serde_json::Value>, IpcError> {
    let project_root = state
        .project_root
        .lock()
        .map_err(|e| IpcError::PlatformError {
            message: format!("Failed to acquire state lock: {}", e),
        })?;

    let path = resolve_mcp_path(&source, &project_root)?;

    if source == "user" {
        // Read the full ~/.claude.json, extract only mcpServers section
        let full = read_json_file(&path)?;
        match full {
            Some(obj) => {
                if let Some(servers) = obj.get("mcpServers") {
                    Ok(Some(serde_json::json!({ "mcpServers": servers })))
                } else {
                    // File exists but has no mcpServers key
                    Ok(Some(serde_json::json!({ "mcpServers": {} })))
                }
            }
            None => Ok(None),
        }
    } else {
        read_json_file(&path)
    }
}

/// IPC command: writes MCP config to the specified writable source.
///
/// For "user" source, reads the existing ~/.claude.json, replaces only the
/// mcpServers key, and writes back (preserving all other keys).
/// For "project" source, performs an atomic write to .claude/.mcp.json.
#[tauri::command]
pub fn write_mcp_config(
    source: String,
    config: serde_json::Value,
    state: State<AppState>,
) -> Result<(), IpcError> {
    let project_root = state
        .project_root
        .lock()
        .map_err(|e| IpcError::PlatformError {
            message: format!("Failed to acquire state lock: {}", e),
        })?;

    // Only "project" and "user" are writable
    if source != "project" && source != "user" {
        return Err(IpcError::PlatformError {
            message: format!("MCP source '{}' is not writable", source),
        });
    }

    let path = resolve_mcp_path(&source, &project_root)?;
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

    if source == "user" {
        // Read existing ~/.claude.json, replace only mcpServers, write back
        let existing = match read_json_file(&path)? {
            Some(v) => v,
            None => serde_json::json!({}),
        };

        let mut obj = match existing {
            serde_json::Value::Object(m) => m,
            _ => serde_json::Map::new(),
        };

        // Extract mcpServers from the incoming config
        let servers = config
            .get("mcpServers")
            .cloned()
            .unwrap_or(serde_json::json!({}));
        obj.insert("mcpServers".to_string(), servers);

        let content = serde_json::to_vec_pretty(&serde_json::Value::Object(obj)).map_err(|e| {
            IpcError::WriteFailed {
                path: path_str.clone(),
                message: format!("Failed to serialize config: {}", e),
            }
        })?;

        atomic_write(Path::new(&path), &content)?;
    } else {
        // Project: atomic write directly
        let content =
            serde_json::to_vec_pretty(&config).map_err(|e| IpcError::WriteFailed {
                path: path_str.clone(),
                message: format!("Failed to serialize config: {}", e),
            })?;

        atomic_write(Path::new(&path), &content)?;
    }

    Ok(())
}

/// IPC command: reads managed MCP config.
///
/// Convenience command equivalent to read_mcp_config with source="managed".
#[tauri::command]
pub fn read_managed_mcp(
    state: State<AppState>,
) -> Result<Option<serde_json::Value>, IpcError> {
    let project_root = state
        .project_root
        .lock()
        .map_err(|e| IpcError::PlatformError {
            message: format!("Failed to acquire state lock: {}", e),
        })?;

    let path = resolve_mcp_path("managed", &project_root)?;
    read_json_file(&path)
}
