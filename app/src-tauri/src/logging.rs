use crate::platform::paths;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::time::SystemTime;

fn timestamp() -> String {
    match SystemTime::now().duration_since(SystemTime::UNIX_EPOCH) {
        Ok(d) => format!("{}", d.as_secs()),
        Err(_) => "0".to_string(),
    }
}

pub fn log_dir() -> PathBuf {
    paths::resolve_config_dir().join("logs")
}

pub fn log_error(message: &str) {
    let dir = log_dir();
    let _ = fs::create_dir_all(&dir);

    let path = dir.join("error.log");

    // Rotate if too large (1MB)
    if let Ok(metadata) = fs::metadata(&path) {
        if metadata.len() > 1_048_576 {
            rotate_logs(&dir);
        }
    }

    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&path) {
        let _ = writeln!(file, "[{}] ERROR {}", timestamp(), message);
    }
}

fn rotate_logs(dir: &PathBuf) {
    // Keep last 5 log files
    for i in (1..5).rev() {
        let from = dir.join(format!("error.{}.log", i));
        let to = dir.join(format!("error.{}.log", i + 1));
        let _ = fs::rename(&from, &to);
    }
    let current = dir.join("error.log");
    let first = dir.join("error.1.log");
    let _ = fs::rename(&current, &first);
}
