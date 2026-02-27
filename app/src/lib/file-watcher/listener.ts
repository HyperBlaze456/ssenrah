import { listen } from "@tauri-apps/api/event";

export interface FileChangeEvent {
  path: string;
  kind: "created" | "modified" | "deleted";
  scope: string;
}

export function onFileChange(
  callback: (event: FileChangeEvent) => void,
): Promise<() => void> {
  return listen<FileChangeEvent>("file_change", (event) => {
    callback(event.payload);
  });
}
