import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import type { ToolDefinition } from "../../agent/types";

type CaptureMode = "fullscreen" | "interactive";
type CaptureFormat = "png" | "jpg";

/**
 * Capture a screenshot to disk.
 *
 * This tool intentionally only captures images; analysis is handled by
 * a separate vision QA tool.
 */
export function createCaptureScreenshotTool(options?: {
  defaultOutputDir?: string;
}): ToolDefinition {
  return {
    name: "capture_screenshot",
    description:
      "Capture a screenshot and save it to disk. Use together with analyze_image_ui_qa.",
    inputSchema: {
      type: "object",
      properties: {
        outputPath: {
          type: "string",
          description:
            "Optional destination path. Defaults to ./screenshots/screen-<timestamp>.png",
        },
        mode: {
          type: "string",
          enum: ["fullscreen", "interactive"],
          description: "Capture mode (default: fullscreen)",
        },
        format: {
          type: "string",
          enum: ["png", "jpg"],
          description: "Output format (default: png)",
        },
      },
      required: [],
    },
    run(input) {
      const mode = normalizeMode(input["mode"]);
      const format = normalizeFormat(input["format"]);

      const outputPath = resolveOutputPath(
        input["outputPath"],
        format,
        options?.defaultOutputDir
      );
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });

      const result = captureToPath(outputPath, mode);
      if (!result.ok) {
        return `Error capturing screenshot: ${result.error}`;
      }

      return JSON.stringify(
        {
          ok: true,
          outputPath,
          mode,
          format,
        },
        null,
        2
      );
    },
  };
}

function resolveOutputPath(
  rawPath: unknown,
  format: CaptureFormat,
  defaultOutputDir?: string
): string {
  if (typeof rawPath === "string" && rawPath.trim() !== "") {
    const resolved = path.resolve(rawPath);
    const ext = path.extname(resolved);
    return ext ? resolved : `${resolved}.${format}`;
  }

  const baseDir = path.resolve(defaultOutputDir ?? "./screenshots");
  const fileName = `screen-${Date.now()}.${format}`;
  return path.join(baseDir, fileName);
}

function captureToPath(
  outputPath: string,
  mode: CaptureMode
): { ok: true } | { ok: false; error: string } {
  if (process.platform === "darwin") {
    const args = mode === "interactive" ? ["-i", "-x", outputPath] : ["-x", outputPath];
    const result = spawnSync("screencapture", args, { encoding: "utf-8" });
    if (result.status !== 0) {
      return {
        ok: false,
        error: result.stderr?.trim() || "screencapture failed",
      };
    }
    return { ok: true };
  }

  if (process.platform === "linux") {
    // ImageMagick import is the most common portable fallback.
    const args =
      mode === "interactive"
        ? [outputPath]
        : ["-window", "root", outputPath];
    const result = spawnSync("import", args, { encoding: "utf-8" });
    if (result.status !== 0) {
      return {
        ok: false,
        error:
          result.stderr?.trim() ||
          "linux screenshot failed (install ImageMagick `import`)",
      };
    }
    return { ok: true };
  }

  if (process.platform === "win32") {
    // Keep this minimal: fullscreen capture only in Windows fallback.
    const escaped = outputPath.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const script = [
      "Add-Type -AssemblyName System.Windows.Forms;",
      "Add-Type -AssemblyName System.Drawing;",
      "$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds;",
      "$bmp = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height;",
      "$graphics = [System.Drawing.Graphics]::FromImage($bmp);",
      "$graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size);",
      `$bmp.Save("${escaped}", [System.Drawing.Imaging.ImageFormat]::Png);`,
      "$graphics.Dispose();",
      "$bmp.Dispose();",
    ].join(" ");
    const result = spawnSync("powershell", ["-NoProfile", "-Command", script], {
      encoding: "utf-8",
    });
    if (result.status !== 0) {
      return {
        ok: false,
        error: result.stderr?.trim() || "powershell screenshot failed",
      };
    }
    return { ok: true };
  }

  return { ok: false, error: `unsupported platform: ${process.platform}` };
}

function normalizeMode(raw: unknown): CaptureMode {
  return raw === "interactive" ? "interactive" : "fullscreen";
}

function normalizeFormat(raw: unknown): CaptureFormat {
  return raw === "jpg" ? "jpg" : "png";
}
