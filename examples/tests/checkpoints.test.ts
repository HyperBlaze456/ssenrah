import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  buildCheckpointPath,
  createCheckpoint,
  defaultSessionCheckpointDir,
  listCheckpointFiles,
  loadCheckpoint,
  loadCheckpointSafe,
  saveCheckpoint,
  validateCheckpoint,
} from "../harness/checkpoints";

describe("harness checkpoints (session-scoped)", () => {
  function createTempBaseDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), "ssenrah-checkpoints-test-"));
  }

  it("uses canonical session-scoped path convention", () => {
    const baseDir = createTempBaseDir();
    const resolved = defaultSessionCheckpointDir("session-123", baseDir);
    expect(resolved).toBe(
      path.join(baseDir, "sessions", "session-123", "checkpoints")
    );

    const checkpointPath = buildCheckpointPath("cp-1", {
      baseDir,
      sessionId: "session-123",
    });
    expect(checkpointPath).toBe(
      path.join(baseDir, "sessions", "session-123", "checkpoints", "cp-1.json")
    );
  });

  it("creates, saves, loads, and lists checkpoints for a session", () => {
    const baseDir = createTempBaseDir();
    const checkpoint = createCheckpoint({
      checkpointId: "cp-1",
      phase: "executing",
      goal: "run team goal",
      policyProfile: "local-permissive",
      pendingTasks: ["t1", "t2"],
      metadata: { owner: "test" },
    });

    const filePath = saveCheckpoint(checkpoint, {
      baseDir,
      sessionId: "session-abc",
    });
    expect(filePath).toBe(
      path.join(baseDir, "sessions", "session-abc", "checkpoints", "cp-1.json")
    );

    const loaded = loadCheckpoint(filePath);
    expect(loaded).toMatchObject({
      schemaVersion: 1,
      checkpointId: "cp-1",
      phase: "executing",
      goal: "run team goal",
      policyProfile: "local-permissive",
      pendingTasks: ["t1", "t2"],
    });

    const files = listCheckpointFiles({ baseDir, sessionId: "session-abc" });
    expect(files).toEqual([filePath]);
  });

  it("returns [] for missing checkpoint directory", () => {
    const baseDir = createTempBaseDir();
    expect(listCheckpointFiles({ baseDir, sessionId: "missing" })).toEqual([]);
  });

  it("handles missing/corrupt checkpoint files safely", () => {
    const baseDir = createTempBaseDir();
    const missing = path.join(baseDir, "sessions", "s", "checkpoints", "missing.json");
    expect(loadCheckpointSafe(missing)).toBeNull();

    const corrupt = path.join(baseDir, "sessions", "s", "checkpoints", "corrupt.json");
    fs.mkdirSync(path.dirname(corrupt), { recursive: true });
    fs.writeFileSync(corrupt, "{not-json", "utf8");
    expect(loadCheckpointSafe(corrupt)).toBeNull();
  });

  it("validates raw checkpoint payloads", () => {
    expect(
      validateCheckpoint({
        schemaVersion: 1,
        checkpointId: "cp-2",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        phase: "planning",
        goal: "test",
      })
    ).toMatchObject({
      checkpointId: "cp-2",
      phase: "planning",
      goal: "test",
    });
  });

  it("rejects traversal-like session ids", () => {
    expect(() =>
      defaultSessionCheckpointDir("..", createTempBaseDir())
    ).toThrow(/sessionId/i);
    expect(() =>
      defaultSessionCheckpointDir(".", createTempBaseDir())
    ).toThrow(/sessionId/i);
  });

  it("rejects traversal-like checkpoint ids", () => {
    expect(() =>
      buildCheckpointPath("../escape", {
        baseDir: createTempBaseDir(),
        sessionId: "session-ok",
      })
    ).toThrow(/checkpointId/i);
  });
});
