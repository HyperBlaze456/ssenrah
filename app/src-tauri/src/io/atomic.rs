use crate::errors::IpcError;
use std::fs;
use std::path::Path;

pub fn atomic_write(path: &Path, content: &[u8]) -> Result<(), IpcError> {
    let tmp_path = path.with_extension("ssenrah-tmp");

    // Write to temp file
    if let Err(e) = fs::write(&tmp_path, content) {
        let _ = fs::remove_file(&tmp_path);
        return Err(IpcError::WriteFailed {
            path: path.display().to_string(),
            message: format!("Failed to write temp file: {}", e),
        });
    }

    // Rename to target
    if let Err(e) = fs::rename(&tmp_path, path) {
        let _ = fs::remove_file(&tmp_path);
        return Err(IpcError::WriteFailed {
            path: path.display().to_string(),
            message: format!("Failed to rename temp file: {}", e),
        });
    }

    Ok(())
}
