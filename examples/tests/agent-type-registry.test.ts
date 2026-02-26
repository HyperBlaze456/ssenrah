import { AgentTypeRegistry } from "../agents/registry";
import type { AgentType } from "../agents/agent-types";

describe("AgentTypeRegistry", () => {
  const explorerType: AgentType = {
    name: "explorer",
    description: "Read-only codebase exploration",
    model: "claude-haiku-4-5-20251001",
    toolPacks: ["filesystem"],
    maxTurns: 10,
    isolation: { readOnly: true, maxDepth: 1 },
  };

  const coderType: AgentType = {
    name: "coder",
    description: "Full codebase editing",
    model: "claude-sonnet-4-6",
    toolPacks: ["filesystem"],
    maxTurns: 20,
  };

  it("registers and retrieves an agent type", () => {
    const registry = new AgentTypeRegistry();
    registry.register(explorerType);

    const result = registry.get("explorer");
    expect(result).toBeDefined();
    expect(result!.name).toBe("explorer");
    expect(result!.model).toBe("claude-haiku-4-5-20251001");
  });

  it("returns undefined for unknown type", () => {
    const registry = new AgentTypeRegistry();
    expect(registry.get("nonexistent")).toBeUndefined();
  });

  it("lists all registered types", () => {
    const registry = new AgentTypeRegistry();
    registry.register(explorerType);
    registry.register(coderType);

    const list = registry.list();
    expect(list).toHaveLength(2);
    expect(list.map((t) => t.name).sort()).toEqual(["coder", "explorer"]);
  });

  it("has() returns true for registered types", () => {
    const registry = new AgentTypeRegistry();
    registry.register(explorerType);

    expect(registry.has("explorer")).toBe(true);
    expect(registry.has("coder")).toBe(false);
  });

  it("overwrites on duplicate name registration", () => {
    const registry = new AgentTypeRegistry();
    registry.register(explorerType);
    registry.register({ ...explorerType, model: "different-model" });

    const result = registry.get("explorer");
    expect(result!.model).toBe("different-model");
    expect(registry.list()).toHaveLength(1);
  });

  it("trims whitespace from names", () => {
    const registry = new AgentTypeRegistry();
    registry.register({ ...explorerType, name: "  explorer  " });

    expect(registry.has("explorer")).toBe(true);
    expect(registry.get("explorer")!.name).toBe("explorer");
  });

  it("throws on empty name", () => {
    const registry = new AgentTypeRegistry();
    expect(() =>
      registry.register({ ...explorerType, name: "" })
    ).toThrow("non-empty name");
  });

  it("supports chained registration", () => {
    const registry = new AgentTypeRegistry();
    const result = registry.register(explorerType).register(coderType);

    expect(result).toBe(registry);
    expect(registry.list()).toHaveLength(2);
  });

  it("preserves isolation config", () => {
    const registry = new AgentTypeRegistry();
    registry.register(explorerType);

    const result = registry.get("explorer");
    expect(result!.isolation).toEqual({ readOnly: true, maxDepth: 1 });
  });
});
