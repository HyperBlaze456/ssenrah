use serde::Serialize;

use crate::types::ValidationError;

/// IPC error types matching the TypeScript contract:
///
/// ```typescript
/// type IpcError =
///   | { kind: "not_found"; path: string }
///   | { kind: "permission_denied"; path: string }
///   | { kind: "parse_error"; path: string; message: string }
///   | { kind: "write_failed"; path: string; message: string }
///   | { kind: "validation_error"; errors: ValidationError[] }
///   | { kind: "no_project"; message: string }
///   | { kind: "platform_error"; message: string };
/// ```
#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum IpcError {
    NotFound {
        path: String,
    },
    PermissionDenied {
        path: String,
    },
    ParseError {
        path: String,
        message: String,
    },
    WriteFailed {
        path: String,
        message: String,
    },
    ValidationError {
        errors: Vec<ValidationError>,
    },
    NoProject {
        message: String,
    },
    PlatformError {
        message: String,
    },
}

impl std::fmt::Display for IpcError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            IpcError::NotFound { path } => write!(f, "not found: {}", path),
            IpcError::PermissionDenied { path } => write!(f, "permission denied: {}", path),
            IpcError::ParseError { path, message } => {
                write!(f, "parse error at {}: {}", path, message)
            }
            IpcError::WriteFailed { path, message } => {
                write!(f, "write failed at {}: {}", path, message)
            }
            IpcError::ValidationError { errors } => {
                write!(f, "validation errors: {} issue(s)", errors.len())
            }
            IpcError::NoProject { message } => write!(f, "no project: {}", message),
            IpcError::PlatformError { message } => write!(f, "platform error: {}", message),
        }
    }
}

// IpcError derives Serialize, so Tauri's blanket
// `impl<T: Serialize> From<T> for InvokeError` handles
// conversion automatically — no manual From impl needed.
