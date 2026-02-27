mod commands;
mod errors;
mod io;
mod lockfile;
mod platform;
mod schema;
mod types;
mod watcher;

use std::sync::Mutex;

pub use errors::IpcError;
pub use types::*;

/// Managed application state shared across IPC commands.
pub struct AppState {
    pub project_root: Mutex<Option<String>>,
}

/// Entry point called from main.rs.
///
/// Builds the Tauri application with plugins and IPC command handlers.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(AppState {
            project_root: Mutex::new(None),
        })
        .manage(commands::watcher::WatcherState {
            watcher: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            commands::platform::get_platform_info,
            commands::project::get_project_info,
            commands::project::open_project,
            commands::settings::read_settings,
            commands::settings::write_settings,
            commands::validation::validate_settings,
            commands::validation::validate_permission_rule,
            commands::validation::validate_hook_matcher,
            commands::mcp::read_mcp_config,
            commands::mcp::write_mcp_config,
            commands::mcp::read_managed_mcp,
            commands::managed::read_managed_settings,
            commands::memory::read_memory,
            commands::memory::write_memory,
            commands::agents::list_agents,
            commands::agents::read_agent,
            commands::agents::write_agent,
            commands::agents::delete_agent,
            commands::effective::compute_effective_config,
            commands::skills::list_skills,
            commands::skills::read_skill,
            commands::skills::write_skill,
            commands::skills::delete_skill,
            commands::skills::read_skill_file,
            commands::skills::write_skill_file,
            io::ensure::ensure_claude_dir,
            commands::watcher::subscribe_file_changes,
            commands::watcher::unsubscribe_file_changes,
        ])
        .setup(|_app| {
            lockfile::acquire_lock().map_err(|e| Box::new(std::io::Error::new(std::io::ErrorKind::Other, e)))?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, event| {
            if let tauri::RunEvent::Exit = event {
                lockfile::release_lock();
            }
        });
}
