import * as path from "path";
import { loadToolPackManifest } from "../tools/manifest";
import { assertToolPackAllowed, toExtensionManifestFromToolPack } from "../tools/toolpack-policy";
import { RuntimePolicy } from "../teams/policy";

describe("toolpack trust policy bridge", () => {
  const fixtureDir = path.join(__dirname, "..", "tools", "toolpacks");

  it("maps manifest risk profile into extension capabilities", () => {
    const manifest = loadToolPackManifest(path.join(fixtureDir, "filesystem.json"));
    const extension = toExtensionManifestFromToolPack(manifest);
    expect(extension.name).toBe("toolpack.filesystem");
    expect(extension.capabilities).toEqual(["read", "write", "trace"]);
  });

  it("enforces trust-gating when enabled", () => {
    const manifest = loadToolPackManifest(path.join(fixtureDir, "filesystem.json"));
    const policy = new RuntimePolicy({ trustGatingEnabled: true });

    expect(() =>
      assertToolPackAllowed(policy, manifest, "workspace", "workspace")
    ).not.toThrow();

    expect(() =>
      assertToolPackAllowed(policy, manifest, "untrusted", "workspace")
    ).toThrow(/requires trust/i);
  });
});
