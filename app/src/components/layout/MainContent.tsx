import { useUiStore } from "@/lib/store/ui";
import { PanelHeader } from "./PanelHeader";
import { PanelPlaceholder } from "../shared/PanelPlaceholder";
import { EffectiveConfigFooter } from "./EffectiveConfigFooter";
import { ScrollArea } from "@/components/ui/scroll-area";
import { PermissionsPanel } from "@/components/permissions/PermissionsPanel";
import { SandboxPanel } from "@/components/sandbox/SandboxPanel";
import { EnvPanel } from "@/components/env/EnvPanel";
import { DisplayPanel } from "@/components/display/DisplayPanel";
import { AdvancedPanel } from "@/components/advanced/AdvancedPanel";
import { McpPanel } from "@/components/mcp/McpPanel";
import { HooksPanel } from "@/components/hooks/HooksPanel";
import { PluginsPanel } from "@/components/plugins/PluginsPanel";
import { MemoryPanel } from "@/components/memory/MemoryPanel";
import { AgentsPanel } from "@/components/agents/AgentsPanel";
import { SkillsPanel } from "@/components/skills/SkillsPanel";
import { EffectivePanel } from "@/components/visualizer/EffectivePanel";
import type { PanelId } from "@/types";
import { PANELS } from "@/types";

const PANEL_COMPONENTS: Partial<Record<PanelId, React.ComponentType>> = {
  permissions: PermissionsPanel,
  sandbox: SandboxPanel,
  env: EnvPanel,
  display: DisplayPanel,
  advanced: AdvancedPanel,
  mcp: McpPanel,
  hooks: HooksPanel,
  plugins: PluginsPanel,
  memory: MemoryPanel,
  agents: AgentsPanel,
  skills: SkillsPanel,
  effective: EffectivePanel,
};

export function MainContent() {
  const activePanel = useUiStore((s) => s.activePanel);
  const activeScope = useUiStore((s) => s.activeScope);
  const panel = PANELS.find((p) => p.id === activePanel);
  const readOnly = activeScope === "managed";
  const PanelComponent = PANEL_COMPONENTS[activePanel];

  return (
    <main className="flex flex-1 flex-col overflow-hidden">
      <PanelHeader
        title={panel?.label ?? ""}
        scope={activeScope}
        readOnly={readOnly}
      />
      <ScrollArea className="flex-1 p-6">
        {PanelComponent ? <PanelComponent /> : <PanelPlaceholder panelId={activePanel} />}
      </ScrollArea>
      <EffectiveConfigFooter />
    </main>
  );
}
