use std::fs;
use std::path::{Path, PathBuf};

use serde_json::json;
use tauri::State;

use crate::errors::IpcError;
use crate::io::atomic::atomic_write;
use crate::platform::paths;
use crate::AppState;

/// Resolves the skills (commands) directory for a given scope.
///
/// - "user"    -> {configDir}/commands/
/// - "project" -> {projectRoot}/.claude/commands/
fn resolve_skills_dir(scope: &str, project_root: &Option<String>) -> Result<PathBuf, IpcError> {
    match scope {
        "user" => {
            let config_dir = paths::resolve_config_dir();
            Ok(config_dir.join("commands"))
        }
        "project" => {
            let root = project_root.as_ref().ok_or_else(|| IpcError::NoProject {
                message: "No project is open. Open a project before accessing project skills."
                    .to_string(),
            })?;
            Ok(PathBuf::from(root).join(".claude").join("commands"))
        }
        _ => Err(IpcError::PlatformError {
            message: format!("Unknown skill scope: {}", scope),
        }),
    }
}

/// Parse YAML frontmatter from a markdown file.
fn parse_frontmatter(content: &str) -> (serde_json::Value, String) {
    let trimmed = content.trim_start();
    if !trimmed.starts_with("---") {
        return (json!({}), content.to_string());
    }

    let after_first = &trimmed[3..];
    let after_first = after_first.trim_start_matches(['\r', '\n']);

    if let Some(end_idx) = after_first.find("\n---") {
        let yaml_part = &after_first[..end_idx];
        let body_start = end_idx + 4;
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
        (json!({}), content.to_string())
    }
}

/// Simple YAML-like parser for key: value lines.
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

            if value == "true" {
                map.insert(key, json!(true));
                continue;
            }
            if value == "false" {
                map.insert(key, json!(false));
                continue;
            }

            if let Ok(n) = value.parse::<i64>() {
                map.insert(key, json!(n));
                continue;
            }

            if let Ok(n) = value.parse::<f64>() {
                map.insert(key, json!(n));
                continue;
            }

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

/// IPC command: lists skill directories from one or both scopes.
///
/// Each skill is a directory containing a SKILL.md file. Returns an array of
/// `{ directory, scope, frontmatter, bodyPreview }`.
#[tauri::command]
pub fn list_skills(
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

    let mut skills = Vec::new();

    for s in scopes {
        let dir = match resolve_skills_dir(s, &project_root) {
            Ok(d) => d,
            Err(_) => continue,
        };

        if !dir.exists() {
            continue;
        }

        let entries = fs::read_dir(&dir).map_err(|e| IpcError::PlatformError {
            message: format!("Failed to read skills directory: {}", e),
        })?;

        for entry in entries {
            let entry = entry.map_err(|e| IpcError::PlatformError {
                message: format!("Failed to read directory entry: {}", e),
            })?;

            let path = entry.path();
            if !path.is_dir() {
                // Skills can also be single .md files in the commands directory
                if path.extension().and_then(|e| e.to_str()) == Some("md") {
                    let filename = entry.file_name().to_string_lossy().to_string();
                    let content = fs::read_to_string(&path).unwrap_or_default();
                    let (frontmatter, body) = parse_frontmatter(&content);
                    let preview: String = body.chars().take(200).collect();

                    skills.push(json!({
                        "directory": filename,
                        "scope": s,
                        "frontmatter": frontmatter,
                        "bodyPreview": preview,
                    }));
                }
                continue;
            }

            let dir_name = entry.file_name().to_string_lossy().to_string();
            let skill_md = path.join("SKILL.md");

            if !skill_md.exists() {
                continue;
            }

            let content = fs::read_to_string(&skill_md).unwrap_or_default();
            let (frontmatter, body) = parse_frontmatter(&content);
            let preview: String = body.chars().take(200).collect();

            skills.push(json!({
                "directory": dir_name,
                "scope": s,
                "frontmatter": frontmatter,
                "bodyPreview": preview,
            }));
        }
    }

    Ok(skills)
}

/// IPC command: reads a single skill's SKILL.md and returns its frontmatter and body.
#[tauri::command]
pub fn read_skill(
    scope: String,
    directory: String,
    state: State<AppState>,
) -> Result<serde_json::Value, IpcError> {
    let project_root = state
        .project_root
        .lock()
        .map_err(|e| IpcError::PlatformError {
            message: format!("Failed to acquire state lock: {}", e),
        })?;

    let dir = resolve_skills_dir(&scope, &project_root)?;

    // Check if it's a direct .md file (single-file skill)
    let skill_path = if directory.ends_with(".md") {
        dir.join(&directory)
    } else {
        dir.join(&directory).join("SKILL.md")
    };

    let path_str = skill_path.display().to_string();

    let content = fs::read_to_string(&skill_path).map_err(|e| match e.kind() {
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

/// IPC command: writes a skill's SKILL.md with YAML frontmatter and markdown body.
#[tauri::command]
pub fn write_skill(
    scope: String,
    directory: String,
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

    let base_dir = resolve_skills_dir(&scope, &project_root)?;

    let (skill_dir, skill_path) = if directory.ends_with(".md") {
        (base_dir.clone(), base_dir.join(&directory))
    } else {
        let sd = base_dir.join(&directory);
        let sp = sd.join("SKILL.md");
        (sd, sp)
    };

    // Ensure directory exists
    if !skill_dir.exists() {
        fs::create_dir_all(&skill_dir).map_err(|e| IpcError::WriteFailed {
            path: skill_dir.display().to_string(),
            message: format!("Failed to create skill directory: {}", e),
        })?;
    }

    let path_str = skill_path.display().to_string();

    let fm = serialize_frontmatter(&frontmatter);
    let content = if fm.is_empty() {
        body
    } else {
        format!("---\n{}\n---\n\n{}", fm, body)
    };

    atomic_write(Path::new(&skill_path), content.as_bytes()).map_err(|_| {
        IpcError::WriteFailed {
            path: path_str,
            message: "Atomic write failed".to_string(),
        }
    })?;

    Ok(())
}

/// IPC command: deletes a skill directory (or single .md file).
#[tauri::command]
pub fn delete_skill(
    scope: String,
    directory: String,
    state: State<AppState>,
) -> Result<(), IpcError> {
    let project_root = state
        .project_root
        .lock()
        .map_err(|e| IpcError::PlatformError {
            message: format!("Failed to acquire state lock: {}", e),
        })?;

    let base_dir = resolve_skills_dir(&scope, &project_root)?;

    let path = if directory.ends_with(".md") {
        base_dir.join(&directory)
    } else {
        base_dir.join(&directory)
    };

    let path_str = path.display().to_string();

    if !path.exists() {
        return Err(IpcError::NotFound { path: path_str });
    }

    if path.is_dir() {
        fs::remove_dir_all(&path).map_err(|e| IpcError::WriteFailed {
            path: path_str,
            message: format!("Failed to delete skill directory: {}", e),
        })?;
    } else {
        fs::remove_file(&path).map_err(|e| IpcError::WriteFailed {
            path: path_str,
            message: format!("Failed to delete skill file: {}", e),
        })?;
    }

    Ok(())
}

/// IPC command: reads an arbitrary file within a skill directory.
#[tauri::command]
pub fn read_skill_file(
    scope: String,
    directory: String,
    filename: String,
    state: State<AppState>,
) -> Result<String, IpcError> {
    let project_root = state
        .project_root
        .lock()
        .map_err(|e| IpcError::PlatformError {
            message: format!("Failed to acquire state lock: {}", e),
        })?;

    let base_dir = resolve_skills_dir(&scope, &project_root)?;
    let path = base_dir.join(&directory).join(&filename);
    let path_str = path.display().to_string();

    fs::read_to_string(&path).map_err(|e| match e.kind() {
        std::io::ErrorKind::NotFound => IpcError::NotFound {
            path: path_str.clone(),
        },
        std::io::ErrorKind::PermissionDenied => IpcError::PermissionDenied {
            path: path_str.clone(),
        },
        _ => IpcError::PlatformError {
            message: format!("Failed to read {}: {}", path_str, e),
        },
    })
}

/// IPC command: writes an arbitrary file within a skill directory.
#[tauri::command]
pub fn write_skill_file(
    scope: String,
    directory: String,
    filename: String,
    content: String,
    state: State<AppState>,
) -> Result<(), IpcError> {
    let project_root = state
        .project_root
        .lock()
        .map_err(|e| IpcError::PlatformError {
            message: format!("Failed to acquire state lock: {}", e),
        })?;

    let base_dir = resolve_skills_dir(&scope, &project_root)?;
    let skill_dir = base_dir.join(&directory);

    // Ensure skill directory exists
    if !skill_dir.exists() {
        fs::create_dir_all(&skill_dir).map_err(|e| IpcError::WriteFailed {
            path: skill_dir.display().to_string(),
            message: format!("Failed to create skill directory: {}", e),
        })?;
    }

    let path = skill_dir.join(&filename);
    let path_str = path.display().to_string();

    atomic_write(Path::new(&path), content.as_bytes()).map_err(|_| IpcError::WriteFailed {
        path: path_str,
        message: "Atomic write failed".to_string(),
    })?;

    Ok(())
}
