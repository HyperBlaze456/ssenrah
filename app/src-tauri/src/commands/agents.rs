use std::fs;
use std::path::{Path, PathBuf};

use serde_json::json;
use tauri::State;

use crate::errors::IpcError;
use crate::io::atomic::atomic_write;
use crate::platform::paths;
use crate::AppState;

/// Resolves the agents directory for a given scope.
///
/// - "user"    -> {configDir}/agents/
/// - "project" -> {projectRoot}/.claude/agents/
fn resolve_agents_dir(scope: &str, project_root: &Option<String>) -> Result<PathBuf, IpcError> {
    match scope {
        "user" => {
            let config_dir = paths::resolve_config_dir();
            Ok(config_dir.join("agents"))
        }
        "project" => {
            let root = project_root.as_ref().ok_or_else(|| IpcError::NoProject {
                message: "No project is open. Open a project before accessing project agents."
                    .to_string(),
            })?;
            Ok(PathBuf::from(root).join(".claude").join("agents"))
        }
        _ => Err(IpcError::PlatformError {
            message: format!("Unknown agent scope: {}", scope),
        }),
    }
}

/// Parse YAML frontmatter from a markdown file.
///
/// Splits the content on "---" markers. The text between the first and second
/// "---" lines is treated as YAML frontmatter (parsed into a JSON value via
/// simple key: value line parsing). Everything after the second "---" is the body.
fn parse_frontmatter(content: &str) -> (serde_json::Value, String) {
    let trimmed = content.trim_start();
    if !trimmed.starts_with("---") {
        return (json!({}), content.to_string());
    }

    // Find the closing ---
    let after_first = &trimmed[3..];
    let after_first = after_first.trim_start_matches(['\r', '\n']);

    if let Some(end_idx) = after_first.find("\n---") {
        let yaml_part = &after_first[..end_idx];
        let body_start = end_idx + 4; // skip "\n---"
        let body = if body_start < after_first.len() {
            after_first[body_start..]
                .trim_start_matches(['\r', '\n'])
                .to_string()
        } else {
            String::new()
        };

        let frontmatter = parse_yaml_simple(yaml_part);
        (frontmatter, body)
    } else {
        // No closing ---, treat entire content as body
        (json!({}), content.to_string())
    }
}

/// Simple YAML-like parser for frontmatter key: value pairs.
///
/// Handles strings, booleans, numbers, and bracket-delimited arrays.
fn parse_yaml_simple(yaml: &str) -> serde_json::Value {
    let mut map = serde_json::Map::new();

    for line in yaml.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }

        if let Some((key, value)) = line.split_once(':') {
            let key = key.trim().to_string();
            let value = value.trim();

            if value.is_empty() {
                map.insert(key, json!(null));
                continue;
            }

            // Array: [item1, item2, ...]
            if value.starts_with('[') && value.ends_with(']') {
                let inner = &value[1..value.len() - 1];
                let items: Vec<serde_json::Value> = inner
                    .split(',')
                    .map(|s| {
                        let s = s.trim().trim_matches('"').trim_matches('\'');
                        json!(s)
                    })
                    .collect();
                map.insert(key, json!(items));
                continue;
            }

            // Boolean
            if value == "true" {
                map.insert(key, json!(true));
                continue;
            }
            if value == "false" {
                map.insert(key, json!(false));
                continue;
            }

            // Number (integer)
            if let Ok(n) = value.parse::<i64>() {
                map.insert(key, json!(n));
                continue;
            }

            // Number (float)
            if let Ok(n) = value.parse::<f64>() {
                map.insert(key, json!(n));
                continue;
            }

            // String (strip optional quotes)
            let s = value.trim_matches('"').trim_matches('\'');
            map.insert(key, json!(s));
        }
    }

    serde_json::Value::Object(map)
}

/// Serialize a JSON value as YAML-like frontmatter lines.
fn serialize_frontmatter(frontmatter: &serde_json::Value) -> String {
    let mut lines = Vec::new();
    if let Some(obj) = frontmatter.as_object() {
        for (key, value) in obj {
            match value {
                serde_json::Value::String(s) => lines.push(format!("{}: {}", key, s)),
                serde_json::Value::Bool(b) => lines.push(format!("{}: {}", key, b)),
                serde_json::Value::Number(n) => lines.push(format!("{}: {}", key, n)),
                serde_json::Value::Array(arr) => {
                    let items: Vec<String> = arr
                        .iter()
                        .map(|v| match v {
                            serde_json::Value::String(s) => s.clone(),
                            other => other.to_string(),
                        })
                        .collect();
                    lines.push(format!("{}: [{}]", key, items.join(", ")));
                }
                serde_json::Value::Null => {}
                _ => {
                    lines.push(format!(
                        "{}: {}",
                        key,
                        serde_json::to_string(value).unwrap_or_default()
                    ));
                }
            }
        }
    }
    lines.join("\n")
}

/// IPC command: lists agent .md files from one or both scopes.
///
/// Returns an array of `{ filename, scope, frontmatter, bodyPreview }`.
#[tauri::command]
pub fn list_agents(
    scope: Option<String>,
    state: State<AppState>,
) -> Result<Vec<serde_json::Value>, IpcError> {
    let project_root = state
        .project_root
        .lock()
        .map_err(|e| IpcError::PlatformError {
            message: format!("Failed to acquire state lock: {}", e),
        })?;

    let scopes: Vec<&str> = match scope.as_deref() {
        Some(s) => vec![s],
        None => vec!["user", "project"],
    };

    let mut agents = Vec::new();

    for s in scopes {
        let dir = match resolve_agents_dir(s, &project_root) {
            Ok(d) => d,
            Err(_) => continue, // Skip scopes that can't be resolved (e.g. no project open)
        };

        if !dir.exists() {
            continue;
        }

        let entries = fs::read_dir(&dir).map_err(|e| IpcError::PlatformError {
            message: format!("Failed to read agents directory: {}", e),
        })?;

        for entry in entries {
            let entry = entry.map_err(|e| IpcError::PlatformError {
                message: format!("Failed to read directory entry: {}", e),
            })?;

            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("md") {
                continue;
            }

            let filename = entry.file_name().to_string_lossy().to_string();
            let content = fs::read_to_string(&path).unwrap_or_default();
            let (frontmatter, body) = parse_frontmatter(&content);

            let preview: String = body.chars().take(200).collect();

            agents.push(json!({
                "filename": filename,
                "scope": s,
                "frontmatter": frontmatter,
                "bodyPreview": preview,
            }));
        }
    }

    Ok(agents)
}

/// IPC command: reads a single agent .md file and returns its frontmatter and body.
#[tauri::command]
pub fn read_agent(
    scope: String,
    filename: String,
    state: State<AppState>,
) -> Result<serde_json::Value, IpcError> {
    let project_root = state
        .project_root
        .lock()
        .map_err(|e| IpcError::PlatformError {
            message: format!("Failed to acquire state lock: {}", e),
        })?;

    let dir = resolve_agents_dir(&scope, &project_root)?;
    let path = dir.join(&filename);
    let path_str = path.display().to_string();

    let content = fs::read_to_string(&path).map_err(|e| match e.kind() {
        std::io::ErrorKind::NotFound => IpcError::NotFound {
            path: path_str.clone(),
        },
        std::io::ErrorKind::PermissionDenied => IpcError::PermissionDenied {
            path: path_str.clone(),
        },
        _ => IpcError::PlatformError {
            message: format!("Failed to read {}: {}", path_str, e),
        },
    })?;

    let (frontmatter, body) = parse_frontmatter(&content);

    Ok(json!({
        "frontmatter": frontmatter,
        "body": body,
    }))
}

/// IPC command: writes an agent .md file with YAML frontmatter and markdown body.
#[tauri::command]
pub fn write_agent(
    scope: String,
    filename: String,
    frontmatter: serde_json::Value,
    body: String,
    state: State<AppState>,
) -> Result<(), IpcError> {
    let project_root = state
        .project_root
        .lock()
        .map_err(|e| IpcError::PlatformError {
            message: format!("Failed to acquire state lock: {}", e),
        })?;

    let dir = resolve_agents_dir(&scope, &project_root)?;

    // Ensure directory exists
    if !dir.exists() {
        fs::create_dir_all(&dir).map_err(|e| IpcError::WriteFailed {
            path: dir.display().to_string(),
            message: format!("Failed to create agents directory: {}", e),
        })?;
    }

    let path = dir.join(&filename);
    let path_str = path.display().to_string();

    // Build file content: --- frontmatter --- body
    let fm = serialize_frontmatter(&frontmatter);
    let content = if fm.is_empty() {
        body
    } else {
        format!("---\n{}\n---\n\n{}", fm, body)
    };

    atomic_write(Path::new(&path), content.as_bytes()).map_err(|_| IpcError::WriteFailed {
        path: path_str,
        message: "Atomic write failed".to_string(),
    })?;

    Ok(())
}

/// IPC command: deletes an agent .md file.
#[tauri::command]
pub fn delete_agent(
    scope: String,
    filename: String,
    state: State<AppState>,
) -> Result<(), IpcError> {
    let project_root = state
        .project_root
        .lock()
        .map_err(|e| IpcError::PlatformError {
            message: format!("Failed to acquire state lock: {}", e),
        })?;

    let dir = resolve_agents_dir(&scope, &project_root)?;
    let path = dir.join(&filename);
    let path_str = path.display().to_string();

    if !path.exists() {
        return Err(IpcError::NotFound { path: path_str });
    }

    fs::remove_file(&path).map_err(|e| IpcError::WriteFailed {
        path: path_str,
        message: format!("Failed to delete agent file: {}", e),
    })?;

    Ok(())
}
