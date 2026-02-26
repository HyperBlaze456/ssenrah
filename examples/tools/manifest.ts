import * as fs from "fs";
import * as path from "path";

export interface ToolPackManifest {
  schemaVersion: 1;
  name: string;
  description: string;
  tools: string[];
  riskProfile: "read-only" | "standard" | "privileged";
  tags?: string[];
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((item) => typeof item === "string" && item.trim().length > 0)
  );
}

export function parseToolPackManifest(
  raw: unknown,
  source = "toolpack-manifest"
): ToolPackManifest {
  if (typeof raw !== "object" || raw === null) {
    throw new Error(`${source}: manifest must be a JSON object`);
  }
  const obj = raw as Record<string, unknown>;

  if (obj["schemaVersion"] !== 1) {
    throw new Error(`${source}: schemaVersion must be 1`);
  }

  if (typeof obj["name"] !== "string" || obj["name"].trim() === "") {
    throw new Error(`${source}: name must be a non-empty string`);
  }

  if (
    typeof obj["description"] !== "string" ||
    obj["description"].trim() === ""
  ) {
    throw new Error(`${source}: description must be a non-empty string`);
  }

  if (!isStringArray(obj["tools"]) || obj["tools"].length === 0) {
    throw new Error(`${source}: tools must be a non-empty string[]`);
  }

  const riskProfile = obj["riskProfile"];
  if (
    riskProfile !== "read-only" &&
    riskProfile !== "standard" &&
    riskProfile !== "privileged"
  ) {
    throw new Error(
      `${source}: riskProfile must be one of read-only|standard|privileged`
    );
  }

  if (obj["tags"] !== undefined && !isStringArray(obj["tags"])) {
    throw new Error(`${source}: tags must be string[] when provided`);
  }

  return {
    schemaVersion: 1,
    name: obj["name"].trim(),
    description: obj["description"].trim(),
    tools: Array.from(new Set((obj["tools"] as string[]).map((item) => item.trim()))),
    riskProfile,
    tags:
      obj["tags"] !== undefined
        ? Array.from(new Set((obj["tags"] as string[]).map((item) => item.trim())))
        : undefined,
  };
}

export function loadToolPackManifest(filePath: string): ToolPackManifest {
  const absolute = path.resolve(filePath);
  const raw = fs.readFileSync(absolute, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  return parseToolPackManifest(parsed, absolute);
}

export function loadToolPackManifestsFromDir(dirPath: string): ToolPackManifest[] {
  const absoluteDir = path.resolve(dirPath);
  const files = fs
    .readdirSync(absoluteDir)
    .filter((entry) => entry.toLowerCase().endsWith(".json"))
    .sort((a, b) => a.localeCompare(b));

  return files.map((fileName) => loadToolPackManifest(path.join(absoluteDir, fileName)));
}

