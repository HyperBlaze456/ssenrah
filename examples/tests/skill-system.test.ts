import fs from "fs";
import os from "os";
import path from "path";
import { createVisionQAHook } from "../harness/components/vision-qa";
import { loadMarkdownSkill, createMarkdownSkillHook } from "../harness/skills";
import { createDefaultToolRegistry } from "../tools/registry";
import type { AgentRunHookContext } from "../agent/types";

describe("markdown skills", () => {
  it("loads markdown skill metadata + instructions", () => {
    const tmpFile = path.join(os.tmpdir(), `skill-${Date.now()}.md`);
    fs.writeFileSync(
      tmpFile,
      `---\nname: test-skill\ndescription: sample\n---\nDo thing A.\nDo thing B.`,
      "utf-8"
    );
    try {
      const skill = loadMarkdownSkill(tmpFile);
      expect(skill.name).toBe("test-skill");
      expect(skill.summary).toBe("sample");
      expect(skill.instructions).toContain("Do thing A.");
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  it("injects skill prompt through hook", async () => {
    const tmpFile = path.join(os.tmpdir(), `skill-hook-${Date.now()}.md`);
    fs.writeFileSync(tmpFile, "Use strict checklist.", "utf-8");
    try {
      const hook = createMarkdownSkillHook(tmpFile, {
        activateWhen: () => true,
      });
      const context: AgentRunHookContext = {
        userMessage: "run qa",
        history: [],
        settings: {
          model: "test-model",
          systemPrompt: "base",
          tools: [],
        },
      };
      await hook(context);
      expect(context.settings.systemPrompt).toContain("Skill:");
      expect(context.settings.systemPrompt).toContain("Use strict checklist.");
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });
});

describe("vision qa hook + tool registry", () => {
  it("injects only screenshot/vision tools via registry packs", async () => {
    const mockProvider = {
      name: "mock",
      chat: jest.fn().mockResolvedValue({
        textBlocks: ["{}"],
        toolCalls: [],
        stopReason: "end_turn" as const,
      }),
    };
    const registry = createDefaultToolRegistry({
      visionProvider: mockProvider,
      visionModel: "gemini-2.0-flash",
    });

    const hook = createVisionQAHook({
      activateWhen: () => true,
      model: "vision-model",
    });

    const context: AgentRunHookContext = {
      userMessage: "vision qa this screenshot",
      history: [],
      toolRegistry: registry,
      settings: {
        model: "base-model",
        systemPrompt: "base prompt",
        tools: registry.resolvePacks(["filesystem"]),
      },
    };

    await hook(context);

    expect(context.settings.model).toBe("vision-model");
    const names = context.settings.tools.map((t) => t.name);
    expect(names).toContain("capture_screenshot");
    expect(names).toContain("analyze_image_ui_qa");
    // Filesystem tools remain available unless caller chooses otherwise.
    expect(names).toContain("read_file");
  });
});
