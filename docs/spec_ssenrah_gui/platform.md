# Platform-Specific Behavior

Config file paths per OS, managed settings locations, shell detection, Claude Code installation detection, and OS-specific file watching.

**Related**: [file-io.md](file-io.md) for path resolution logic, [errors.md](errors.md) for platform error handling.

---

## Config File Paths

### User Config Directory (`configDir`)

The base directory for user-scoped Claude Code configuration.

| Platform | Default Path | Override |
|----------|-------------|----------|
| macOS | `~/.claude/` | `$CLAUDE_CONFIG_DIR` |
| Linux | `~/.claude/` | `$CLAUDE_CONFIG_DIR` |
| Windows (native) | `%USERPROFILE%\.claude\` | `$CLAUDE_CONFIG_DIR` |
| WSL | `~/.claude/` (Linux home) | `$CLAUDE_CONFIG_DIR` |

**Resolution logic**:
```
resolve_config_dir():
  if env CLAUDE_CONFIG_DIR is set:
    return CLAUDE_CONFIG_DIR
  return join(home_dir(), ".claude")
```

### User Config File (`~/.claude.json`)

| Platform | Path |
|----------|------|
| macOS | `~/.claude.json` |
| Linux | `~/.claude.json` |
| Windows (native) | `%USERPROFILE%\.claude.json` |
| WSL | `~/.claude.json` |

### Managed Settings Directory

IT-enforced settings and MCP configurations. Location varies by OS.

| Platform | Directory | Files |
|----------|-----------|-------|
| macOS | `/Library/Application Support/ClaudeCode/` | `managed-settings.json`, `managed-mcp.json` |
| Linux | `/etc/claude-code/` | `managed-settings.json`, `managed-mcp.json` |
| Windows (native) | Registry: `HKLM\SOFTWARE\Anthropic\ClaudeCode` | Values stored as registry entries |
| Windows (MDM) | Registry: `HKLM\SOFTWARE\Policies\Anthropic\ClaudeCode` | Policy-managed values |
| WSL | `/etc/claude-code/` (Linux path inside WSL) | `managed-settings.json`, `managed-mcp.json` |

**Windows registry handling**: On native Windows, managed settings are read from the Windows registry instead of JSON files. The Rust backend translates registry values into the same `ManagedSettings` structure used on other platforms.

### Project Paths

Project-scoped paths are relative to the project root and are the same across all platforms:

```
{projectRoot}/.claude/settings.json
{projectRoot}/.claude/settings.local.json
{projectRoot}/.claude/.mcp.json
{projectRoot}/.claude/CLAUDE.md
{projectRoot}/.claude/CLAUDE.local.md
{projectRoot}/CLAUDE.md
{projectRoot}/.claude/agents/*.md
{projectRoot}/.claude/skills/*/SKILL.md
```

---

## Shell Detection

The GUI needs to know the user's shell for:
- Displaying hook commands correctly
- Suggesting shell-appropriate commands
- Environment variable expansion behavior

### Detection Strategy

```
detect_shell():
  // 1. Check CLAUDE_CODE_SHELL env var (user override)
  if env CLAUDE_CODE_SHELL is set:
    return CLAUDE_CODE_SHELL

  // 2. Check SHELL env var (Unix standard)
  if env SHELL is set:
    return SHELL

  // 3. Platform-specific fallback
  match platform:
    macOS  → return "/bin/zsh"
    Linux  → return "/bin/bash"
    Windows → return "cmd.exe"      // or PowerShell if detected
    WSL    → return "/bin/bash"
```

### Windows Shell Detection

On native Windows, additional detection:
```
detect_windows_shell():
  // Check if PowerShell is the preferred shell
  if env PSModulePath is set:
    return "powershell.exe"
  return "cmd.exe"
```

---

## Claude Code Installation Detection

### Detection Strategy

```
detect_claude_code():
  // 1. Check PATH for 'claude' binary
  path = which("claude")
  if path exists:
    return { installed: true, path }

  // 2. Check common installation locations
  match platform:
    macOS:
      check "/usr/local/bin/claude"
      check "$HOME/.claude/bin/claude"
      check "$HOME/.npm/bin/claude"

    Linux:
      check "/usr/local/bin/claude"
      check "$HOME/.claude/bin/claude"
      check "$HOME/.npm/bin/claude"

    Windows:
      check "%APPDATA%\npm\claude.cmd"
      check "%LOCALAPPDATA%\Programs\claude\claude.exe"

    WSL:
      check "/usr/local/bin/claude"
      check "$HOME/.claude/bin/claude"
      // Also check Windows-side: /mnt/c/Users/*/AppData/*/npm/claude.cmd

  // 3. Not found
  return { installed: false, path: null }
```

### Version Detection

If the binary is found:
```
detect_claude_version(path):
  output = exec(path + " --version")
  parse semver from output
  return version or null
```

---

## WSL-Specific Behavior

### Detection

```
is_wsl():
  // Check /proc/version for Microsoft signature
  if file_exists("/proc/version"):
    content = read("/proc/version")
    return content.contains("microsoft") or content.contains("Microsoft")
  return false
```

### Path Translation

When running in WSL, the GUI needs to handle both Linux and Windows paths:

- Config files use Linux paths (WSL filesystem)
- Project roots may be on the Windows filesystem (`/mnt/c/...`)
- File watchers work on both WSL and mounted Windows filesystems

```
// WSL path ↔ Windows path translation (for display purposes)
wsl_to_windows(path: string): string
  // /mnt/c/Users/foo → C:\Users\foo
  match = path.match(/^\/mnt\/([a-z])\/(.*)/)
  if match: return match[1].toUpperCase() + ":\\" + match[2].replace(/\//g, "\\")
  return path  // pure Linux path, no translation

windows_to_wsl(path: string): string
  // C:\Users\foo → /mnt/c/Users/foo
  match = path.match(/^([A-Za-z]):\\(.*)/)
  if match: return "/mnt/" + match[1].toLowerCase() + "/" + match[2].replace(/\\/g, "/")
  return path
```

### File Watching on WSL

The `notify` crate works differently on WSL:
- Native WSL filesystem (`/home/...`): inotify works normally
- Mounted Windows filesystem (`/mnt/c/...`): inotify may have delays or miss events
- **Mitigation**: For `/mnt/` paths, supplement `notify` with periodic polling (2 second interval) as a fallback

---

## OS-Specific File Watching

| Platform | Watcher Backend | Notes |
|----------|----------------|-------|
| macOS | FSEvents | Reliable, batch notifications |
| Linux | inotify | Reliable, per-file watches |
| Windows (native) | ReadDirectoryChangesW | Reliable, directory-level |
| WSL (native fs) | inotify | Works normally |
| WSL (mounted fs) | inotify + poll fallback | inotify unreliable on `/mnt/`, poll at 2s |

### Debounce

All platforms apply 100ms debounce on file watcher events to coalesce rapid multi-event sequences (e.g., editors that delete-then-write).

---

## Home Directory Resolution

```
resolve_home_dir():
  // 1. Check HOME env var (Unix, WSL)
  if env HOME is set:
    return HOME

  // 2. Check USERPROFILE (Windows native)
  if env USERPROFILE is set:
    return USERPROFILE

  // 3. Platform fallback
  match platform:
    macOS, Linux, WSL → return "/home/" + env USER
    Windows → return "C:\\Users\\" + env USERNAME
```

---

## Platform Info Summary

The `get_platform_info` IPC command assembles all detection results:

```typescript
interface PlatformInfo {
  os: "macos" | "linux" | "windows";
  isWsl: boolean;
  shell: string;                      // e.g., "/bin/zsh", "/bin/bash", "powershell.exe"
  claudeCodeInstalled: boolean;
  claudeCodePath: string | null;
  claudeCodeVersion: string | null;   // semver if detected
  configDir: string;                  // resolved absolute path
  managedSettingsDir: string | null;  // null if no managed settings found
  homeDir: string;
}
```
