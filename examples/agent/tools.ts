import fs from "fs";
import path from "path";
import { ToolDefinition } from "./types";

/**
 * Resolve a user-supplied path to an absolute path within workspaceRoot.
 *
 * Two-stage check:
 *   1. Lexical check — reject ".." escapes immediately (cheap, no I/O)
 *   2. Symlink check — walk each path segment and reject symlinks that
 *      could point outside the workspace (blocks symlink traversal attacks)
 *
 * For paths to files that do not yet exist (e.g. new files created by
 * edit_file), only existing segments are checked for symlinks.
 *
 * Throws if the path escapes the workspace.
 */
function resolveSafePath(raw: unknown, workspaceRoot: string): string {
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new Error("path must be a non-empty string");
  }

  // Canonicalise workspace root (resolves any symlinks in the root itself)
  const rootReal = fs.existsSync(workspaceRoot)
    ? fs.realpathSync(workspaceRoot)
    : path.resolve(workspaceRoot);

  const full = path.resolve(rootReal, raw);

  // Lexical containment check
  const rel = path.relative(rootReal, full);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`path "${raw}" is outside the allowed workspace`);
  }

  // Symlink traversal check — walk each existing segment
  const segments = rel.split(path.sep).filter(Boolean);
  let cur = rootReal;
  for (const seg of segments) {
    cur = path.join(cur, seg);
    if (!fs.existsSync(cur)) break; // remaining segments don't exist yet
    if (fs.lstatSync(cur).isSymbolicLink()) {
      throw new Error(
        `path "${raw}" contains a symlink and is not allowed`
      );
    }
  }

  return full;
}

/**
 * The directory that filesystem tools are allowed to access.
 * Defaults to process.cwd(). Override by setting AGENT_WORKSPACE env var.
 */
export function getWorkspaceRoot(): string {
  return process.env["AGENT_WORKSPACE"]
    ? path.resolve(process.env["AGENT_WORKSPACE"])
    : process.cwd();
}

/**
 * Read a file's contents from the filesystem.
 * Follows the pattern from ampcode.com/notes/how-to-build-an-agent.
 * Restricted to the configured workspace root.
 */
export const readFileTool: ToolDefinition = {
  name: "read_file",
  description:
    "Read the contents of a file at the given path. Returns the file content as a string.",
  inputSchema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "The path to the file to read (relative or absolute within workspace).",
      },
    },
    required: ["path"],
  },
  run(input) {
    try {
      const filePath = resolveSafePath(input["path"], getWorkspaceRoot());
      return fs.readFileSync(filePath, "utf-8");
    } catch (err) {
      return `Error reading file: ${(err as Error).message}`;
    }
  },
};

/**
 * List files in a directory.
 * Restricted to the configured workspace root.
 */
export const listFilesTool: ToolDefinition = {
  name: "list_files",
  description:
    "List all files and directories at the given path. Defaults to the workspace root.",
  inputSchema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description:
          "The directory path to list (relative to workspace). Defaults to workspace root.",
      },
    },
    required: [],
  },
  run(input) {
    try {
      const root = getWorkspaceRoot();
      const rawPath = (input["path"] as string | undefined) ?? ".";
      const dirPath = resolveSafePath(rawPath, root);
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      const lines = entries.map((e) => {
        const kind = e.isDirectory() ? "dir" : "file";
        return `[${kind}] ${e.name}`;
      });
      return lines.join("\n") || "(empty directory)";
    } catch (err) {
      return `Error listing files: ${(err as Error).message}`;
    }
  },
};

/**
 * Edit a file by replacing a string within it.
 * If old_str is empty, the entire file is replaced with new_str.
 * Restricted to the configured workspace root.
 */
export const editFileTool: ToolDefinition = {
  name: "edit_file",
  description:
    "Edit a file by replacing old_str with new_str. If old_str is empty the whole file is replaced. Creates the file if it does not exist.",
  inputSchema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Path to the file to edit (relative to workspace).",
      },
      old_str: {
        type: "string",
        description:
          "The exact string to replace (first occurrence). If empty, the whole file content is replaced.",
      },
      new_str: {
        type: "string",
        description: "The new string to insert in place of old_str.",
      },
    },
    required: ["path", "old_str", "new_str"],
  },
  run(input) {
    try {
      const filePath = resolveSafePath(input["path"], getWorkspaceRoot());
      const oldStr = input["old_str"] as string;
      const newStr = input["new_str"] as string;

      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      if (oldStr === "") {
        fs.writeFileSync(filePath, newStr, "utf-8");
        return `File written: ${filePath}`;
      }

      if (!fs.existsSync(filePath)) {
        return `Error: file not found: ${filePath}`;
      }

      const content = fs.readFileSync(filePath, "utf-8");
      if (!content.includes(oldStr)) {
        return `Error: old_str not found in ${filePath}`;
      }
      // Replace only the first occurrence (deterministic behavior)
      const updated = content.replace(oldStr, newStr);
      fs.writeFileSync(filePath, updated, "utf-8");
      return `File updated: ${filePath}`;
    } catch (err) {
      return `Error editing file: ${(err as Error).message}`;
    }
  },
};

/**
 * Default set of filesystem tools for an agent.
 */
export const defaultTools: ToolDefinition[] = [
  readFileTool,
  listFilesTool,
  editFileTool,
];
