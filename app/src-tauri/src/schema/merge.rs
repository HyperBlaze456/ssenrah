use serde::Serialize;
use serde_json::{Map, Value};
use std::collections::HashMap;

/// Array fields that use "array replace" semantics: the higher-scope array
/// completely replaces the lower-scope array (no element-level merge).
const ARRAY_REPLACE_FIELDS: &[&str] = &[
    "permissions.allow",
    "permissions.deny",
    "permissions.ask",
    "permissions.additionalDirectories",
    "availableModels",
    "companyAnnouncements",
    "sandbox.excludedCommands",
    "sandbox.network.allowedDomains",
    "sandbox.network.allowUnixSockets",
    "enabledMcpjsonServers",
    "disabledMcpjsonServers",
    "allowedMcpServers",
    "deniedMcpServers",
];

/// Object fields that use "deep merge" semantics: keys are recursively merged
/// rather than replaced wholesale.
const DEEP_MERGE_FIELDS: &[&str] = &[
    "permissions",
    "sandbox",
    "sandbox.network",
    "hooks",
    "env",
    "attribution",
    "spinnerTipsOverride",
    "spinnerVerbs",
    "statusLine",
    "fileSuggestion",
];

/// The merged effective configuration along with source attribution and
/// override information.
#[derive(Debug, Serialize)]
pub struct EffectiveConfig {
    /// The final merged settings object.
    pub settings: Value,
    /// Maps each JSON path (dot-separated) to the scope name that provides it.
    pub sources: HashMap<String, String>,
    /// List of fields where a higher scope overrode a lower scope's value.
    pub overrides: Vec<Override>,
}

/// Describes a single override: a field whose value was set by multiple scopes,
/// with the highest-precedence scope winning.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Override {
    /// Dot-separated JSON path of the field.
    pub path: String,
    /// The scope that ultimately provides the value.
    pub effective_scope: String,
    /// The scopes whose values were overridden (lower precedence).
    pub overridden_scopes: Vec<String>,
    /// The winning value.
    pub effective_value: Value,
}

/// Returns `true` if the given dot-path should use deep-merge semantics.
fn is_deep_merge_field(path: &str) -> bool {
    DEEP_MERGE_FIELDS.contains(&path)
}

/// Returns `true` if the given dot-path should use array-replace semantics.
///
/// This is informational; array-replace and scalar-replace both result in the
/// higher scope's value completely replacing the lower scope's value. The
/// distinction matters for documentation and debugging.
#[allow(dead_code)]
fn is_array_replace_field(path: &str) -> bool {
    ARRAY_REPLACE_FIELDS.contains(&path)
}

/// Computes the effective (merged) configuration from up to four scopes.
///
/// Scopes are applied in precedence order (lowest to highest):
/// user -> project -> local -> managed.
///
/// Each successive scope's values overlay the accumulated result according to
/// per-field merge semantics (replace, array-replace, or deep-merge).
pub fn compute_effective(
    user: Option<&Value>,
    project: Option<&Value>,
    local: Option<&Value>,
    managed: Option<&Value>,
) -> EffectiveConfig {
    let mut result = Map::new();
    let mut sources: HashMap<String, String> = HashMap::new();
    let mut all_paths: HashMap<String, Vec<(String, Value)>> = HashMap::new();

    let scopes = [
        ("user", user),
        ("project", project),
        ("local", local),
        ("managed", managed),
    ];

    for (scope_name, scope_data) in &scopes {
        if let Some(data) = scope_data {
            if let Some(obj) = data.as_object() {
                merge_object(
                    &mut result,
                    obj,
                    scope_name,
                    "",
                    &mut sources,
                    &mut all_paths,
                );
            }
        }
    }

    // Compute overrides: any path touched by more than one scope.
    let mut overrides: Vec<Override> = all_paths
        .iter()
        .filter_map(|(path, entries)| {
            if entries.len() > 1 {
                let effective = entries.last().unwrap();
                let overridden: Vec<String> = entries[..entries.len() - 1]
                    .iter()
                    .map(|(s, _)| s.clone())
                    .collect();
                Some(Override {
                    path: path.clone(),
                    effective_scope: effective.0.clone(),
                    overridden_scopes: overridden,
                    effective_value: effective.1.clone(),
                })
            } else {
                None
            }
        })
        .collect();

    // Sort overrides by path for deterministic output.
    overrides.sort_by(|a, b| a.path.cmp(&b.path));

    EffectiveConfig {
        settings: Value::Object(result),
        sources,
        overrides,
    }
}

/// Recursively merges `source` into `result`, tracking source attribution and
/// all path contributions for override detection.
fn merge_object(
    result: &mut Map<String, Value>,
    source: &Map<String, Value>,
    scope_name: &str,
    prefix: &str,
    sources: &mut HashMap<String, String>,
    all_paths: &mut HashMap<String, Vec<(String, Value)>>,
) {
    for (key, value) in source {
        let path = if prefix.is_empty() {
            key.clone()
        } else {
            format!("{}.{}", prefix, key)
        };

        // null in a higher scope removes the field (acts as delete).
        if value.is_null() {
            result.remove(key);
            sources.insert(path.clone(), scope_name.to_string());
            all_paths
                .entry(path)
                .or_default()
                .push((scope_name.to_string(), value.clone()));
            continue;
        }

        let deep = is_deep_merge_field(&path);

        if deep
            && value.is_object()
            && result.get(key).map_or(false, |v| v.is_object())
        {
            // Deep merge: recursively merge keys from source into existing object.
            let existing = result.get(key).unwrap().as_object().unwrap();
            let mut merged = existing.clone();
            merge_object(
                &mut merged,
                value.as_object().unwrap(),
                scope_name,
                &path,
                sources,
                all_paths,
            );
            result.insert(key.clone(), Value::Object(merged));
        } else {
            // Replace semantics (scalar, array-replace, or first-time set).
            result.insert(key.clone(), value.clone());
            sources.insert(path.clone(), scope_name.to_string());
            all_paths
                .entry(path)
                .or_default()
                .push((scope_name.to_string(), value.clone()));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn scalar_replace() {
        let user = json!({ "model": "claude-3" });
        let project = json!({ "model": "claude-4" });

        let result = compute_effective(Some(&user), Some(&project), None, None);
        assert_eq!(result.settings["model"], "claude-4");
        assert_eq!(result.sources["model"], "project");
        assert_eq!(result.overrides.len(), 1);
        assert_eq!(result.overrides[0].path, "model");
        assert_eq!(result.overrides[0].effective_scope, "project");
        assert_eq!(result.overrides[0].overridden_scopes, vec!["user"]);
    }

    #[test]
    fn deep_merge_permissions() {
        let user = json!({
            "permissions": {
                "defaultMode": "reviewAll",
                "allow": ["Read"]
            }
        });
        let project = json!({
            "permissions": {
                "allow": ["Write"],
                "deny": ["Bash"]
            }
        });

        let result = compute_effective(Some(&user), Some(&project), None, None);
        let perms = result.settings["permissions"].as_object().unwrap();

        // defaultMode comes from user (not overridden by project).
        assert_eq!(perms["defaultMode"], "reviewAll");
        // allow is array-replace at permissions.allow level -> project wins.
        assert_eq!(perms["allow"], json!(["Write"]));
        // deny is new from project.
        assert_eq!(perms["deny"], json!(["Bash"]));
    }

    #[test]
    fn null_deletes_field() {
        let user = json!({ "model": "claude-3", "language": "en" });
        let project = json!({ "model": Value::Null });

        let result = compute_effective(Some(&user), Some(&project), None, None);
        assert!(result.settings.get("model").is_none());
        assert_eq!(result.settings["language"], "en");
    }

    #[test]
    fn managed_highest_precedence() {
        let user = json!({ "model": "a" });
        let project = json!({ "model": "b" });
        let local = json!({ "model": "c" });
        let managed = json!({ "model": "d" });

        let result = compute_effective(
            Some(&user),
            Some(&project),
            Some(&local),
            Some(&managed),
        );
        assert_eq!(result.settings["model"], "d");
        assert_eq!(result.sources["model"], "managed");
    }

    #[test]
    fn env_deep_merge_with_null_delete() {
        let user = json!({
            "env": { "PATH": "/usr/bin", "HOME": "/home/user" }
        });
        let project = json!({
            "env": { "PATH": "/project/bin", "EDITOR": "vim" }
        });
        let local = json!({
            "env": { "HOME": Value::Null }
        });

        let result = compute_effective(Some(&user), Some(&project), Some(&local), None);
        let env = result.settings["env"].as_object().unwrap();

        assert_eq!(env["PATH"], "/project/bin");
        assert_eq!(env["EDITOR"], "vim");
        assert!(env.get("HOME").is_none());
    }

    #[test]
    fn empty_scopes_produce_empty_config() {
        let result = compute_effective(None, None, None, None);
        assert_eq!(result.settings, json!({}));
        assert!(result.sources.is_empty());
        assert!(result.overrides.is_empty());
    }

    #[test]
    fn hooks_deep_merge_at_event_level() {
        let user = json!({
            "hooks": {
                "PreToolUse": [{ "matcher": "*", "hooks": [{ "type": "command", "command": "echo user" }] }]
            }
        });
        let project = json!({
            "hooks": {
                "PostToolUse": [{ "matcher": "*", "hooks": [{ "type": "command", "command": "echo project" }] }]
            }
        });

        let result = compute_effective(Some(&user), Some(&project), None, None);
        let hooks = result.settings["hooks"].as_object().unwrap();

        // Both event keys should be present (deep merge at hooks level).
        assert!(hooks.contains_key("PreToolUse"));
        assert!(hooks.contains_key("PostToolUse"));
    }

    #[test]
    fn hooks_array_replace_at_group_level() {
        let user = json!({
            "hooks": {
                "PreToolUse": [{ "matcher": "*", "hooks": [{ "type": "command", "command": "echo user" }] }]
            }
        });
        let project = json!({
            "hooks": {
                "PreToolUse": [{ "matcher": "Bash", "hooks": [{ "type": "command", "command": "echo project" }] }]
            }
        });

        let result = compute_effective(Some(&user), Some(&project), None, None);
        let hooks = result.settings["hooks"].as_object().unwrap();
        let pre_tool = hooks["PreToolUse"].as_array().unwrap();

        // hooks.PreToolUse is not in DEEP_MERGE_FIELDS, so project replaces user's array.
        assert_eq!(pre_tool.len(), 1);
        assert_eq!(pre_tool[0]["matcher"], "Bash");
    }
}
