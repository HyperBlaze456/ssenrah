import fs from "fs";
import path from "path";
import type {
  ChatContentBlock,
  ChatMessage,
  LLMProvider,
} from "../../providers/types";
import type { ToolDefinition } from "../../agent/types";
import type { QAFinding, QAReport } from "./types";

/**
 * Analyze a screenshot/image and return structured UI/UX QA findings.
 */
export function createAnalyzeImageQATool(
  provider: LLMProvider,
  model: string
): ToolDefinition {
  return {
    name: "analyze_image_ui_qa",
    description:
      "Analyze an image/screenshot for UI/UX quality issues and return structured QA findings.",
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
            "Optional context about the screen (e.g., login page, dashboard)",
        },
      },
      required: ["imagePath"],
    },
    async run(input) {
      const imagePath = input["imagePath"] as string;
      const context = input["context"] as string | undefined;

      if (!imagePath || imagePath.trim() === "") {
        return JSON.stringify({ error: "imagePath is required" });
      }

      const absPath = path.resolve(imagePath);
      if (!fs.existsSync(absPath)) {
        return JSON.stringify({ error: `Image not found: ${absPath}` });
      }

      const imageBuffer = fs.readFileSync(absPath);
      const base64Data = imageBuffer.toString("base64");
      const mimeType = inferMimeType(absPath);

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

      const messages: ChatMessage[] = [{ role: "user", content: contentBlocks }];
      const response = await provider.chat({
        model,
        systemPrompt:
          "You are an expert UI/UX reviewer. Analyze screenshots and return structured QA findings as JSON.",
        messages,
        maxTokens: 2048,
      });

      const text = response.textBlocks.join("\n").trim();
      try {
        const parsed = JSON.parse(stripMarkdownFence(text));
        const report: QAReport = {
          imagePath: absPath,
          findings: normalizeFindings(parsed.findings),
          summary:
            typeof parsed.summary === "string" && parsed.summary.trim() !== ""
              ? parsed.summary
              : "No summary provided",
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
          } satisfies QAReport,
          null,
          2
        );
      }
    },
  };
}

export function parseQAFindings(text: string): QAFinding[] {
  try {
    const parsed = JSON.parse(stripMarkdownFence(text));
    return normalizeFindings(parsed.findings);
  } catch {
    return [];
  }
}

function normalizeFindings(raw: unknown): QAFinding[] {
  if (!Array.isArray(raw)) return [];

  return raw.map((item) => {
    const finding = (item ?? {}) as Record<string, unknown>;
    const severity = toEnum(
      finding["severity"],
      ["critical", "major", "minor", "suggestion"] as const,
      "suggestion"
    );
    const category = toEnum(
      finding["category"],
      ["layout", "accessibility", "consistency", "ux", "content"] as const,
      "ux"
    );
    const description =
      typeof finding["description"] === "string" ? finding["description"] : "";
    const location =
      typeof finding["location"] === "string" ? finding["location"] : undefined;
    const suggestion =
      typeof finding["suggestion"] === "string" ? finding["suggestion"] : "";

    return {
      severity,
      category,
      description,
      location,
      suggestion,
    };
  });
}

function toEnum<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  fallback: T[number]
): T[number] {
  if (typeof value === "string" && (allowed as readonly string[]).includes(value)) {
    return value as T[number];
  }
  return fallback;
}

function stripMarkdownFence(text: string): string {
  return text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
}

function inferMimeType(imagePath: string): string {
  const ext = path.extname(imagePath).toLowerCase();
  switch (ext) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    default:
      return "image/png";
  }
}
