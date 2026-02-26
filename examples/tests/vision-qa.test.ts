import fs from "fs";
import os from "os";
import path from "path";
import { createVisionQATool, parseQAFindings, QAReport } from "../tools/vision-qa";
import type { LLMProvider, ChatRequest, ChatResponse } from "../providers/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockResponse(findings: object[], summary: string): ChatResponse {
  return {
    textBlocks: [JSON.stringify({ findings, summary })],
    toolCalls: [],
    stopReason: "end_turn",
  };
}

function makeMockProvider(response: ChatResponse): LLMProvider {
  return {
    name: "mock",
    chat: jest.fn().mockResolvedValue(response),
  };
}

/** Write a small temp file and return its absolute path. */
function createTempImage(ext = ".png"): string {
  const tmpDir = os.tmpdir();
  const filePath = path.join(tmpDir, `vision-qa-test-${Date.now()}${ext}`);
  // A few bytes is enough — the tool just reads it and base64-encodes it.
  fs.writeFileSync(filePath, Buffer.from([137, 80, 78, 71])); // PNG magic bytes
  return filePath;
}

// ---------------------------------------------------------------------------
// createVisionQATool — shape
// ---------------------------------------------------------------------------

describe("createVisionQATool", () => {
  const model = "gemini-2.0-flash";

  it("returns correct tool definition shape", () => {
    const provider = makeMockProvider(makeMockResponse([], "ok"));
    const tool = createVisionQATool(provider, model);

    expect(tool.name).toBe("screenshot_qa");
    expect(typeof tool.description).toBe("string");
    expect(tool.description.length).toBeGreaterThan(0);
    expect(typeof tool.run).toBe("function");
    expect(tool.inputSchema).toMatchObject({
      type: "object",
      properties: expect.objectContaining({
        imagePath: expect.objectContaining({ type: "string" }),
      }),
      required: expect.arrayContaining(["imagePath"]),
    });
  });

  // -------------------------------------------------------------------------
  // run — missing image
  // -------------------------------------------------------------------------

  it("run returns error JSON for missing image", async () => {
    const provider = makeMockProvider(makeMockResponse([], "ok"));
    const tool = createVisionQATool(provider, model);

    const result = await tool.run({ imagePath: "/nonexistent/image.png" });
    const parsed = JSON.parse(result);
    expect(parsed).toHaveProperty("error");
    expect(parsed.error).toMatch(/Image not found/);
  });

  // -------------------------------------------------------------------------
  // run — message format
  // -------------------------------------------------------------------------

  it("run sends correct message format to provider", async () => {
    const tmpImage = createTempImage(".png");
    try {
      const mockResponse = makeMockResponse(
        [
          {
            severity: "minor",
            category: "ux",
            description: "Button too small",
            location: "bottom-right",
            suggestion: "Increase button size",
          },
        ],
        "Looks mostly fine."
      );
      const provider = makeMockProvider(mockResponse);
      const tool = createVisionQATool(provider, model);

      await tool.run({ imagePath: tmpImage, context: "login page" });

      expect(provider.chat).toHaveBeenCalledTimes(1);
      const callArg: ChatRequest = (provider.chat as jest.Mock).mock.calls[0][0];

      // model forwarded
      expect(callArg.model).toBe(model);
      // system prompt set
      expect(callArg.systemPrompt).toBeTruthy();
      // single user message
      expect(callArg.messages).toHaveLength(1);
      expect(callArg.messages[0].role).toBe("user");

      // content is an array of blocks
      const content = callArg.messages[0].content;
      expect(Array.isArray(content)).toBe(true);
      if (!Array.isArray(content)) throw new Error("content should be array");

      // first block is image
      const imageBlock = content[0];
      expect(imageBlock.type).toBe("image");
      expect(imageBlock.mimeType).toBe("image/png");
      expect(typeof imageBlock.base64Data).toBe("string");
      expect(imageBlock.base64Data!.length).toBeGreaterThan(0);

      // second block is text containing context
      const textBlock = content[1];
      expect(textBlock.type).toBe("text");
      expect(textBlock.text).toContain("login page");
    } finally {
      fs.unlinkSync(tmpImage);
    }
  });

  // -------------------------------------------------------------------------
  // run — parses valid JSON response into QAReport
  // -------------------------------------------------------------------------

  it("run parses valid JSON response into QAReport", async () => {
    const tmpImage = createTempImage(".jpg");
    try {
      const findings = [
        {
          severity: "major",
          category: "accessibility",
          description: "Missing alt text",
          location: "header image",
          suggestion: "Add descriptive alt text",
        },
      ];
      const mockResponse = makeMockResponse(findings, "Accessibility issues found.");
      const provider = makeMockProvider(mockResponse);
      const tool = createVisionQATool(provider, model);

      const result = await tool.run({ imagePath: tmpImage });
      const report: QAReport = JSON.parse(result);

      expect(report.imagePath).toBe(path.resolve(tmpImage));
      expect(report.findings).toHaveLength(1);
      expect(report.findings[0].severity).toBe("major");
      expect(report.findings[0].category).toBe("accessibility");
      expect(report.findings[0].description).toBe("Missing alt text");
      expect(report.findings[0].location).toBe("header image");
      expect(report.findings[0].suggestion).toBe("Add descriptive alt text");
      expect(report.summary).toBe("Accessibility issues found.");
      expect(typeof report.analyzedAt).toBe("string");
      expect(new Date(report.analyzedAt).toISOString()).toBe(report.analyzedAt);
    } finally {
      fs.unlinkSync(tmpImage);
    }
  });

  // -------------------------------------------------------------------------
  // run — handles malformed provider response gracefully
  // -------------------------------------------------------------------------

  it("run handles malformed provider response gracefully", async () => {
    const tmpImage = createTempImage(".png");
    try {
      const provider: LLMProvider = {
        name: "mock",
        chat: jest.fn().mockResolvedValue({
          textBlocks: ["this is not valid JSON at all!!!"],
          toolCalls: [],
          stopReason: "end_turn",
        }),
      };
      const tool = createVisionQATool(provider, model);

      const result = await tool.run({ imagePath: tmpImage });
      const report: QAReport = JSON.parse(result);

      // Should not throw — should fall back gracefully
      expect(report.findings).toEqual([]);
      expect(report.summary).toBe("this is not valid JSON at all!!!");
      expect(report.imagePath).toBe(path.resolve(tmpImage));
    } finally {
      fs.unlinkSync(tmpImage);
    }
  });

  // -------------------------------------------------------------------------
  // run — strips markdown fences from provider response
  // -------------------------------------------------------------------------

  it("run strips markdown fences from provider response before parsing", async () => {
    const tmpImage = createTempImage(".png");
    try {
      const findings = [
        {
          severity: "suggestion",
          category: "content",
          description: "Typo in heading",
          suggestion: "Fix spelling",
        },
      ];
      const fencedJson = "```json\n" + JSON.stringify({ findings, summary: "Minor issues." }) + "\n```";
      const provider: LLMProvider = {
        name: "mock",
        chat: jest.fn().mockResolvedValue({
          textBlocks: [fencedJson],
          toolCalls: [],
          stopReason: "end_turn",
        }),
      };
      const tool = createVisionQATool(provider, model);

      const result = await tool.run({ imagePath: tmpImage });
      const report: QAReport = JSON.parse(result);

      expect(report.findings).toHaveLength(1);
      expect(report.summary).toBe("Minor issues.");
    } finally {
      fs.unlinkSync(tmpImage);
    }
  });
});

// ---------------------------------------------------------------------------
// parseQAFindings
// ---------------------------------------------------------------------------

describe("parseQAFindings", () => {
  it("parses valid JSON findings", () => {
    const input = JSON.stringify({
      findings: [
        {
          severity: "critical",
          category: "layout",
          description: "Overlapping elements",
          location: "hero section",
          suggestion: "Add z-index",
        },
      ],
    });
    const findings = parseQAFindings(input);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("critical");
    expect(findings[0].category).toBe("layout");
    expect(findings[0].description).toBe("Overlapping elements");
    expect(findings[0].location).toBe("hero section");
    expect(findings[0].suggestion).toBe("Add z-index");
  });

  it("returns empty array for invalid JSON", () => {
    const findings = parseQAFindings("not json at all {{{}}}");
    expect(findings).toEqual([]);
  });

  it("strips markdown fences before parsing", () => {
    const inner = JSON.stringify({
      findings: [
        {
          severity: "minor",
          category: "ux",
          description: "Hard to read",
          suggestion: "Increase contrast",
        },
      ],
    });
    const fenced = "```json\n" + inner + "\n```";
    const findings = parseQAFindings(fenced);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("minor");
  });

  it("returns empty array when findings key is absent", () => {
    const input = JSON.stringify({ summary: "all good" });
    const findings = parseQAFindings(input);
    expect(findings).toEqual([]);
  });
});
