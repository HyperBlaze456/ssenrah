import fs from "fs";
import path from "path";
import type { LLMProvider, ChatMessage, ChatContentBlock } from "../providers/types";

export interface QAFinding {
  severity: "critical" | "major" | "minor" | "suggestion";
  category: "layout" | "accessibility" | "consistency" | "ux" | "content";
  description: string;
  location?: string;
  suggestion: string;
}

export interface QAReport {
  imagePath: string;
  findings: QAFinding[];
  summary: string;
  analyzedAt: string;
}

/**
 * Create a screenshot_qa tool that uses a vision-capable LLM provider.
 *
 * The tool:
 * 1. Reads the image file from disk
 * 2. Converts to base64
 * 3. Sends to the provider with a QA-focused prompt
 * 4. Parses the response into structured QAFindings
 * 5. Returns a JSON string of the QAReport
 */
export function createVisionQATool(
  provider: LLMProvider,
  model: string
): {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run: (input: Record<string, unknown>) => Promise<string>;
} {
  return {
    name: "screenshot_qa",
    description:
      "Analyze a screenshot/image for UI/UX quality issues. Returns structured QA findings.",
    inputSchema: {
      type: "object",
      properties: {
        imagePath: {
          type: "string",
          description: "Path to the image file to analyze",
        },
        context: {
          type: "string",
          description:
            "Optional context about what the screenshot shows (e.g., 'login page', 'dashboard')",
        },
      },
      required: ["imagePath"],
    },
    async run(input) {
      const imagePath = input["imagePath"] as string;
      const context = input["context"] as string | undefined;

      const absPath = path.resolve(imagePath);
      if (!fs.existsSync(absPath)) {
        return JSON.stringify({ error: `Image not found: ${absPath}` });
      }

      const imageBuffer = fs.readFileSync(absPath);
      const base64Data = imageBuffer.toString("base64");
      const ext = path.extname(absPath).toLowerCase();
      const mimeType =
        ext === ".png"
          ? "image/png"
          : ext === ".jpg" || ext === ".jpeg"
          ? "image/jpeg"
          : ext === ".gif"
          ? "image/gif"
          : ext === ".webp"
          ? "image/webp"
          : "image/png";

      const contentBlocks: ChatContentBlock[] = [
        { type: "image", mimeType, base64Data },
        {
          type: "text",
          text: `Analyze this screenshot for UI/UX quality issues.${
            context ? ` Context: ${context}` : ""
          }

Return a JSON object with this exact structure:
{
  "findings": [
    {
      "severity": "critical|major|minor|suggestion",
      "category": "layout|accessibility|consistency|ux|content",
      "description": "what the issue is",
      "location": "where in the image",
      "suggestion": "how to fix it"
    }
  ],
  "summary": "one-paragraph overall assessment"
}

Return ONLY the JSON, no markdown fences.`,
        },
      ];

      const messages: ChatMessage[] = [
        { role: "user", content: contentBlocks },
      ];

      const response = await provider.chat({
        model,
        systemPrompt:
          "You are an expert UI/UX reviewer. Analyze screenshots and return structured QA findings as JSON.",
        messages,
        maxTokens: 2048,
      });

      const text = response.textBlocks.join("\n").trim();
      try {
        const cleaned = text
          .replace(/```json\s*/g, "")
          .replace(/```\s*/g, "")
          .trim();
        const parsed = JSON.parse(cleaned);
        const report: QAReport = {
          imagePath: absPath,
          findings: parsed.findings || [],
          summary: parsed.summary || "No summary provided",
          analyzedAt: new Date().toISOString(),
        };
        return JSON.stringify(report, null, 2);
      } catch {
        return JSON.stringify(
          {
            imagePath: absPath,
            findings: [],
            summary: text,
            analyzedAt: new Date().toISOString(),
          },
          null,
          2
        );
      }
    },
  };
}

/**
 * Parse QA findings from raw text (used for testing).
 */
export function parseQAFindings(text: string): QAFinding[] {
  try {
    const cleaned = text
      .replace(/```json\s*/g, "")
      .replace(/```\s*/g, "")
      .trim();
    const parsed = JSON.parse(cleaned);
    return (parsed.findings || []).map((f: Record<string, unknown>) => ({
      severity: f["severity"] || "suggestion",
      category: f["category"] || "ux",
      description: f["description"] || "",
      location: f["location"] as string | undefined,
      suggestion: f["suggestion"] || "",
    }));
  } catch {
    return [];
  }
}
