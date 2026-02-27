import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import type { IpcError } from "@/types";

export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await tauriInvoke<T>(cmd, args);
  } catch (error: unknown) {
    // Tauri returns errors as the serialized IpcError
    if (typeof error === "object" && error !== null && "kind" in error) {
      throw error as IpcError;
    }
    // Unknown error
    throw { kind: "platform_error", message: String(error) } as IpcError;
  }
}
