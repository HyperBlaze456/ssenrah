import fs from "fs";
import path from "path";
import os from "os";
import { readFileTool, listFilesTool, editFileTool, getWorkspaceRoot } from "../agent/tools";

describe("getWorkspaceRoot", () => {
  const originalEnv = process.env["AGENT_WORKSPACE"];

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env["AGENT_WORKSPACE"];
    } else {
      process.env["AGENT_WORKSPACE"] = originalEnv;
    }
  });

  it("returns cwd() when AGENT_WORKSPACE is unset", () => {
    delete process.env["AGENT_WORKSPACE"];
    expect(getWorkspaceRoot()).toBe(process.cwd());
  });

  it("returns resolved AGENT_WORKSPACE when set", () => {
    process.env["AGENT_WORKSPACE"] = "/tmp";
    expect(getWorkspaceRoot()).toBe(path.resolve("/tmp"));
  });
});

describe("readFileTool", () => {
  let tmpDir: string;
  let tmpFile: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ssenrah-test-"));
    tmpFile = path.join(tmpDir, "hello.txt");
    fs.writeFileSync(tmpFile, "hello world", "utf-8");
    process.env["AGENT_WORKSPACE"] = tmpDir;
  });

  afterEach(() => {
    delete process.env["AGENT_WORKSPACE"];
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns file contents for relative path", () => {
    const result = readFileTool.run({ path: "hello.txt" });
    expect(result).toBe("hello world");
  });

  it("returns error on missing file", () => {
    const result = readFileTool.run({ path: "nonexistent.txt" });
    expect(result).toMatch(/Error reading file/);
  });

  it("blocks path traversal attempts", () => {
    const result = readFileTool.run({ path: "../../etc/passwd" });
    expect(result).toMatch(/Error/);
    expect(result).toMatch(/outside the allowed workspace/);
  });

  it("blocks symlink traversal", () => {
    const linkPath = path.join(tmpDir, "evil-link");
    fs.symlinkSync("/etc", linkPath);
    const result = readFileTool.run({ path: "evil-link/passwd" });
    expect(result).toMatch(/Error/);
    expect(result).toMatch(/symlink/);
  });

  it("returns error on empty path", () => {
    const result = readFileTool.run({ path: "" });
    expect(result).toMatch(/Error/);
  });
});

describe("listFilesTool", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ssenrah-list-"));
    fs.writeFileSync(path.join(tmpDir, "a.txt"), "a");
    fs.writeFileSync(path.join(tmpDir, "b.txt"), "b");
    fs.mkdirSync(path.join(tmpDir, "sub"));
    process.env["AGENT_WORKSPACE"] = tmpDir;
  });

  afterEach(() => {
    delete process.env["AGENT_WORKSPACE"];
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("lists files and directories", () => {
    const result = listFilesTool.run({ path: "." }) as string;
    expect(result).toContain("[file] a.txt");
    expect(result).toContain("[file] b.txt");
    expect(result).toContain("[dir] sub");
  });

  it("blocks traversal to parent directory", () => {
    const result = listFilesTool.run({ path: "../.." });
    expect(result).toMatch(/Error/);
  });

  it("returns error on missing sub-directory", () => {
    const result = listFilesTool.run({ path: "missing-sub" });
    expect(result).toMatch(/Error listing files/);
  });
});

describe("editFileTool", () => {
  let tmpDir: string;
  let tmpFile: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ssenrah-edit-"));
    tmpFile = path.join(tmpDir, "edit.txt");
    fs.writeFileSync(tmpFile, "foo bar baz", "utf-8");
    process.env["AGENT_WORKSPACE"] = tmpDir;
  });

  afterEach(() => {
    delete process.env["AGENT_WORKSPACE"];
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("replaces a string in the file (relative path)", () => {
    editFileTool.run({ path: "edit.txt", old_str: "bar", new_str: "QUX" });
    expect(fs.readFileSync(tmpFile, "utf-8")).toBe("foo QUX baz");
  });

  it("overwrites entire file when old_str is empty", () => {
    editFileTool.run({ path: "edit.txt", old_str: "", new_str: "new content" });
    expect(fs.readFileSync(tmpFile, "utf-8")).toBe("new content");
  });

  it("creates a new file when old_str is empty and file does not exist", () => {
    editFileTool.run({ path: "new.txt", old_str: "", new_str: "created" });
    expect(fs.readFileSync(path.join(tmpDir, "new.txt"), "utf-8")).toBe("created");
  });

  it("returns error when old_str not found", () => {
    const result = editFileTool.run({ path: "edit.txt", old_str: "NOTHERE", new_str: "x" });
    expect(result).toMatch(/Error: old_str not found/);
  });

  it("blocks path traversal on write", () => {
    const result = editFileTool.run({ path: "../../evil.txt", old_str: "", new_str: "hack" });
    expect(result).toMatch(/Error/);
    expect(result).toMatch(/outside the allowed workspace/);
  });
});
