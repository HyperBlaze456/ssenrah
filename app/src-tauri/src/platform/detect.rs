use std::path::Path;
use std::process::Command;

/// Returns the target OS as a lowercase string.
pub fn detect_os() -> &'static str {
    if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "linux") {
        "linux"
    } else {
        "unknown"
    }
}

/// Checks whether we are running inside WSL by reading /proc/version.
pub fn is_wsl() -> bool {
    if !cfg!(target_os = "linux") {
        return false;
    }

    match std::fs::read_to_string("/proc/version") {
        Ok(contents) => {
            let lower = contents.to_lowercase();
            lower.contains("microsoft")
        }
        Err(_) => false,
    }
}

/// Detects the user's shell.
///
/// Priority:
/// 1. CLAUDE_CODE_SHELL environment variable
/// 2. SHELL environment variable
/// 3. Platform fallback (/bin/sh on Unix, cmd.exe on Windows)
pub fn detect_shell() -> String {
    if let Ok(shell) = std::env::var("CLAUDE_CODE_SHELL") {
        if !shell.is_empty() {
            return shell;
        }
    }

    if let Ok(shell) = std::env::var("SHELL") {
        if !shell.is_empty() {
            return shell;
        }
    }

    if cfg!(target_os = "windows") {
        "cmd.exe".to_string()
    } else {
        "/bin/sh".to_string()
    }
}

/// Detects whether Claude Code is installed and returns (installed, path).
///
/// On Unix, uses `which claude`. Also checks common installation paths
/// as a fallback.
pub fn detect_claude_code() -> (bool, Option<String>) {
    // Try `which` on Unix, `where` on Windows
    let which_result = if cfg!(target_os = "windows") {
        Command::new("where").arg("claude").output()
    } else {
        Command::new("which").arg("claude").output()
    };

    if let Ok(output) = which_result {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() {
                return (true, Some(path));
            }
        }
    }

    // Fallback: check common installation paths
    let common_paths: Vec<&str> = if cfg!(target_os = "macos") {
        vec![
            "/usr/local/bin/claude",
            "/opt/homebrew/bin/claude",
        ]
    } else if cfg!(target_os = "windows") {
        vec![
            // Windows common paths — typically handled by `where` above
        ]
    } else {
        // Linux / WSL
        vec![
            "/usr/local/bin/claude",
            "/usr/bin/claude",
        ]
    };

    for candidate in common_paths {
        if Path::new(candidate).exists() {
            return (true, Some(candidate.to_string()));
        }
    }

    // Also check ~/.npm-global/bin/claude and ~/.local/bin/claude
    if let Some(home) = dirs::home_dir() {
        let candidates = [
            home.join(".npm-global/bin/claude"),
            home.join(".local/bin/claude"),
            home.join(".nvm/versions/node").join("*/bin/claude"), // won't glob, but leave for illustration
        ];
        for candidate in &candidates[..2] {
            if candidate.exists() {
                return (true, Some(candidate.to_string_lossy().to_string()));
            }
        }
    }

    (false, None)
}
