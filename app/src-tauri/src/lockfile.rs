use crate::platform::paths;
use std::fs;
use std::path::PathBuf;

pub fn lockfile_path() -> PathBuf {
    paths::resolve_config_dir().join(".ssenrah.lock")
}

pub fn acquire_lock() -> Result<(), String> {
    let path = lockfile_path();
    if path.exists() {
        // Check if the PID in the lockfile is still running
        if let Ok(content) = fs::read_to_string(&path) {
            if let Ok(pid) = content.trim().parse::<u32>() {
                if is_process_running(pid) {
                    return Err("Another ssenrah instance is already running".to_string());
                }
            }
        }
        // Stale lockfile, remove it
        let _ = fs::remove_file(&path);
    }

    // Create lockfile with our PID
    let pid = std::process::id();
    fs::write(&path, pid.to_string()).map_err(|e| format!("Failed to create lockfile: {}", e))?;
    Ok(())
}

pub fn release_lock() {
    let _ = fs::remove_file(lockfile_path());
}

fn is_process_running(pid: u32) -> bool {
    std::path::Path::new(&format!("/proc/{}", pid)).exists()
}
