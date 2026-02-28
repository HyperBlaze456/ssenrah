import { RuntimePolicy, ExtensionCapability, ExtensionManifest } from "../teams/policy";
import { TrustLevel } from "../teams/types";
import { ToolPackManifest } from "./manifest";

const RISK_TO_CAPABILITIES: Readonly<
  Record<ToolPackManifest["riskProfile"], ExtensionCapability[]>
> = {
  "read-only": ["read", "trace"],
  standard: ["read", "write", "trace"],
  privileged: ["read", "write", "exec", "network", "trace"],
};

export function toExtensionManifestFromToolPack(
  manifest: ToolPackManifest,
  trustRequired: TrustLevel = "workspace"
): ExtensionManifest {
  return {
    name: `toolpack.${manifest.name}`,
    version: "1.0.0",
    trustRequired,
    capabilities: [...RISK_TO_CAPABILITIES[manifest.riskProfile]],
  };
}

export function assertToolPackAllowed(
  policy: RuntimePolicy,
  manifest: ToolPackManifest,
  currentTrust: TrustLevel,
  trustRequired: TrustLevel = "workspace"
): void {
  policy.assertExtensionAllowed(
    toExtensionManifestFromToolPack(manifest, trustRequired),
    currentTrust
  );
}
