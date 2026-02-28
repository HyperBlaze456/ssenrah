import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  buildCheckpointPath,
  createCheckpoint,
  listCheckpointFiles,
  loadCheckpoint,
  saveCheckpoint,
  validateCheckpoint,
} from "../harness/checkpoint";

describe("harness checkpoint format", () => {
  function createTempDir(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), "ssenrah-checkpoint-test-"));
  }

  it("creates, saves, loads, and lists checkpoints", () => {
    const dir = createTempDir();
    const checkpoint = createCheckpoint({
      checkpointId: "cp-1",
      phase: "executing",
      goal: "run team goal",
      policyProfile: "local-permissive",
      pendingTasks: ["t1", "t2"],
      metadata: { owner: "test" },
    });

    const filePath = saveCheckpoint(checkpoint, dir);
    expect(filePath).toBe(buildCheckpointPath("cp-1", dir));

    const loaded = loadCheckpoint(filePath);
    expect(loaded).toMatchObject({
      schemaVersion: 1,
      checkpointId: "cp-1",
      phase: "executing",
      goal: "run team goal",
      policyProfile: "local-permissive",
      pendingTasks: ["t1", "t2"],
    });

    const files = listCheckpointFiles(dir);
    expect(files).toEqual([filePath]);
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

    expect(() =>
      validateCheckpoint({
        schemaVersion: 1,
        checkpointId: "",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        phase: "planning",
        goal: "test",
      })
    ).toThrow(/checkpointId/i);
  });
});
