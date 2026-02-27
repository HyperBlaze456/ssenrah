use regex::Regex;
use serde::Serialize;

use crate::errors::IpcError;
use crate::types::{ConfigScope, ValidationError, ValidationWarning};

/// Result of validating a settings object.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidationResult {
    pub valid: bool,
    pub errors: Vec<ValidationError>,
    pub warnings: Vec<ValidationWarning>,
}

/// Result of validating a permission rule string.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionRuleResult {
    pub valid: bool,
    pub tool: String,
    pub specifier: Option<String>,
    pub error: Option<String>,
}

/// Result of validating a hook matcher pattern.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HookMatcherResult {
    pub valid: bool,
    pub error: Option<String>,
}

/// IPC command: validates a settings JSON object for a given scope.
///
/// Currently performs basic structural checks. Returns valid: true with
/// empty errors/warnings. Full validation will be added later.
#[tauri::command]
pub fn validate_settings(
    settings: serde_json::Value,
    _scope: ConfigScope,
) -> Result<ValidationResult, IpcError> {
    // Basic structural check: settings must be an object
    if !settings.is_object() {
        return Ok(ValidationResult {
            valid: false,
            errors: vec![ValidationError {
                path: "".to_string(),
                message: "Settings must be a JSON object".to_string(),
                code: "INVALID_TYPE".to_string(),
            }],
            warnings: vec![],
        });
    }

    // Placeholder: full validation comes later
    Ok(ValidationResult {
        valid: true,
        errors: vec![],
        warnings: vec![],
    })
}

/// IPC command: validates a permission rule string.
///
/// Parses the rule to extract a tool name and optional specifier.
/// Format: `ToolName` or `ToolName(specifier)`.
#[tauri::command]
pub fn validate_permission_rule(rule: String) -> Result<PermissionRuleResult, IpcError> {
    let re = Regex::new(r"^([A-Za-z_]+)(?:\((.+)\))?$").map_err(|e| IpcError::PlatformError {
        message: format!("Failed to compile regex: {}", e),
    })?;

    match re.captures(&rule) {
        Some(caps) => {
            let tool = caps.get(1).unwrap().as_str().to_string();
            let specifier = caps.get(2).map(|m| m.as_str().to_string());
            Ok(PermissionRuleResult {
                valid: true,
                tool,
                specifier,
                error: None,
            })
        }
        None => Ok(PermissionRuleResult {
            valid: false,
            tool: String::new(),
            specifier: None,
            error: Some(format!(
                "Invalid permission rule format: '{}'. Expected ToolName or ToolName(specifier).",
                rule
            )),
        }),
    }
}

/// IPC command: validates a hook matcher pattern by compiling it as a regex.
#[tauri::command]
pub fn validate_hook_matcher(pattern: String) -> Result<HookMatcherResult, IpcError> {
    match Regex::new(&pattern) {
        Ok(_) => Ok(HookMatcherResult {
            valid: true,
            error: None,
        }),
        Err(e) => Ok(HookMatcherResult {
            valid: false,
            error: Some(format!("Invalid regex pattern: {}", e)),
        }),
    }
}
