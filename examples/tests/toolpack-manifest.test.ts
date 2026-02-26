import * as path from "path";
import {
  loadToolPackManifest,
  loadToolPackManifestsFromDir,
  parseToolPackManifest,
} from "../tools/manifest";

describe("toolpack manifests", () => {
  const fixtureDir = path.join(__dirname, "..", "tools", "toolpacks");

  it("loads draft manifests from the toolpacks directory", () => {
    const manifests = loadToolPackManifestsFromDir(fixtureDir);
    const names = manifests.map((manifest) => manifest.name).sort();
    expect(names).toEqual(["filesystem", "screenshot", "vision-analysis"]);
  });

  it("loads a single manifest", () => {
    const filesystem = loadToolPackManifest(
      path.join(fixtureDir, "filesystem.json")
    );
    expect(filesystem).toMatchObject({
      schemaVersion: 1,
      name: "filesystem",
      riskProfile: "standard",
    });
    expect(filesystem.tools).toEqual(["read_file", "list_files", "edit_file"]);
  });

  it("rejects invalid manifests", () => {
    expect(() =>
      parseToolPackManifest({
        schemaVersion: 1,
        name: "bad-pack",
        description: "missing tools and bad risk profile",
        tools: [],
        riskProfile: "danger-zone",
      })
    ).toThrow(/tools must be a non-empty string\[\]/i);
  });
});

