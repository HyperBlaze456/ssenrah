import { invoke } from "./invoke";
import type { PlatformInfo, ProjectInfo } from "@/types";

export async function getPlatformInfo(): Promise<PlatformInfo> {
  return invoke<PlatformInfo>("get_platform_info");
}

export async function getProjectInfo(): Promise<ProjectInfo> {
  return invoke<ProjectInfo>("get_project_info");
}

export async function openProject(path: string): Promise<ProjectInfo> {
  return invoke<ProjectInfo>("open_project", { path });
}
