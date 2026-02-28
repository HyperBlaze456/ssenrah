/**
 * Backward-compatible exports for legacy imports.
 *
 * New architecture:
 * - screenshot capture tool: tools/vision/capture-screenshot.ts
 * - image QA tool: tools/vision/analyze-image.ts
 * - markdown skill: skills/vision-qa.md
 */
import type { LLMProvider } from "../providers/types";
import type { ToolDefinition } from "../agent/types";
import { createAnalyzeImageQATool } from "./vision/analyze-image";

export type { QAFinding, QAReport } from "./vision/types";
export { parseQAFindings, createAnalyzeImageQATool } from "./vision/analyze-image";
export { createCaptureScreenshotTool } from "./vision/capture-screenshot";

/**
 * Legacy alias retained to avoid breaking existing callers.
 * New callers should use `createAnalyzeImageQATool`.
 */
export function createVisionQATool(
  provider: LLMProvider,
  model: string
): ToolDefinition {
  const tool = createAnalyzeImageQATool(provider, model);
  return {
    ...tool,
    name: "screenshot_qa",
  };
}
