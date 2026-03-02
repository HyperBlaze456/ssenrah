import { inferRiskLevel } from "../harness/risk-inference";

describe("inferRiskLevel", () => {
  it("classifies common read tools as read", () => {
    expect(inferRiskLevel("read_file")).toBe("read");
    expect(inferRiskLevel("list_tasks")).toBe("read");
  });

  it("classifies common write tools as write", () => {
    expect(inferRiskLevel("edit_file")).toBe("write");
    expect(inferRiskLevel("submit_result")).toBe("write");
  });

  it("classifies command tools as exec", () => {
    expect(inferRiskLevel("exec_command")).toBe("exec");
    expect(inferRiskLevel("spawn_agent")).toBe("exec");
  });

  it("classifies destructive tool names as destructive", () => {
    expect(inferRiskLevel("reject_task")).toBe("destructive");
    expect(inferRiskLevel("delete_file")).toBe("destructive");
  });

  it("classifies destructive command payloads as destructive", () => {
    expect(inferRiskLevel("exec_command", { cmd: "rm -rf /tmp/x" })).toBe(
      "destructive"
    );
  });

  it("defaults unknown tools to exec", () => {
    expect(inferRiskLevel("custom_tool")).toBe("exec");
  });
});
