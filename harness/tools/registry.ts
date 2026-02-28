import type { ToolDefinition, ToolRegistry } from "../agent/types";
import { editFileTool, listFilesTool, readFileTool } from "../agent/tools";
import type { LLMProvider } from "../providers/types";
import { createCaptureScreenshotTool } from "./vision/capture-screenshot";
import { createAnalyzeImageQATool } from "./vision/analyze-image";
import type { SpawnAgentToolDeps } from "./spawn-agent";
import { createSpawnAgentTool } from "./spawn-agent";
import type { TaskToolsDeps } from "./task-tools";
import { createTaskTools } from "./task-tools";

export class StaticToolRegistry implements ToolRegistry {
  private readonly packs = new Map<string, ToolDefinition[]>();

  registerPack(packName: string, tools: ToolDefinition[]): this {
    this.packs.set(packName, dedupeTools(tools));
    return this;
  }

  resolvePacks(packNames: string[]): ToolDefinition[] {
    const collected: ToolDefinition[] = [];
    for (const packName of packNames) {
      const pack = this.packs.get(packName);
      if (!pack) {
        throw new Error(`Unknown tool pack: ${packName}`);
      }
      collected.push(...pack);
    }
    return dedupeTools(collected);
  }

  listPackNames(): string[] {
    return Array.from(this.packs.keys()).sort();
  }
}

export function createDefaultToolRegistry(options?: {
  visionProvider?: LLMProvider;
  visionModel?: string;
  screenshotOutputDir?: string;
  /** Deps for the spawn_agent tool. When provided, registers the "spawn" pack. */
  spawnDeps?: SpawnAgentToolDeps;
  /** Deps for the task list tools. When provided, registers the "tasklist" pack. */
  taskToolsDeps?: TaskToolsDeps;
}): StaticToolRegistry {
  const registry = new StaticToolRegistry();

  registry.registerPack("filesystem", [readFileTool, listFilesTool, editFileTool]);

  if (options?.visionProvider && options?.visionModel) {
    registry.registerPack("screenshot", [
      createCaptureScreenshotTool({
        defaultOutputDir: options.screenshotOutputDir,
      }),
    ]);
    registry.registerPack("vision-analysis", [
      createAnalyzeImageQATool(options.visionProvider, options.visionModel),
    ]);
  }

  if (options?.spawnDeps) {
    registry.registerPack("spawn", [createSpawnAgentTool(options.spawnDeps)]);
  }

  if (options?.taskToolsDeps) {
    registry.registerPack("tasklist", createTaskTools(options.taskToolsDeps));
  }

  return registry;
}

function dedupeTools(tools: ToolDefinition[]): ToolDefinition[] {
  const byName = new Map<string, ToolDefinition>();
  for (const tool of tools) {
    byName.set(tool.name, tool);
  }
  return Array.from(byName.values());
}
