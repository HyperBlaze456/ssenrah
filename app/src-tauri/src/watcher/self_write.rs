// Self-write tracking is integrated into DebouncedWatcher.
// This module provides the SelfWriteTracker type for standalone use.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

pub struct SelfWriteTracker {
    writes: Arc<Mutex<HashMap<PathBuf, Instant>>>,
}

impl SelfWriteTracker {
    pub fn new() -> Self {
        Self {
            writes: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn record(&self, path: PathBuf) {
        let mut writes = self.writes.lock().unwrap();
        writes.insert(path, Instant::now());
        // Clean old entries
        writes.retain(|_, time| time.elapsed() < Duration::from_secs(1));
    }

    pub fn is_self_write(&self, path: &PathBuf) -> bool {
        let writes = self.writes.lock().unwrap();
        writes
            .get(path)
            .map_or(false, |time| time.elapsed() < Duration::from_millis(200))
    }
}
