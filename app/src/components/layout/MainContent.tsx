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
import { ActivityPanel } from "@/components/monitor/ActivityPanel";
import { SessionsPanel } from "@/components/monitor/SessionsPanel";
import { RunTracePanel } from "@/components/monitor/RunTracePanel";
import { CostPanel } from "@/components/monitor/CostPanel";
import { AlertsPanel } from "@/components/monitor/AlertsPanel";
import { ReasoningPanel } from "@/components/monitor/ReasoningPanel";
import { AnomalyPanel } from "@/components/monitor/AnomalyPanel";
import { VerifyPanel } from "@/components/monitor/VerifyPanel";
import type { PanelId } from "@/types";
import { PANELS, MONITOR_PANELS, isMonitorPanel, panelSupportsProvider } from "@/types";

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
  activity: ActivityPanel,
  sessions: SessionsPanel,
  run_trace: RunTracePanel,
  cost: CostPanel,
  alerts: AlertsPanel,
  reasoning: ReasoningPanel,
  anomalies: AnomalyPanel,
  verify: VerifyPanel,
};

export function MainContent() {
  const activePanel = useUiStore((s) => s.activePanel);
  const activeScope = useUiStore((s) => s.activeScope);
  const activeProvider = useUiStore((s) => s.activeProvider);
  const isMonitor = isMonitorPanel(activePanel);
  const isImmersiveMonitor = activePanel === "run_trace";
  const panel =
    PANELS.find((p) => p.id === activePanel) ??
    MONITOR_PANELS.find((p) => p.id === activePanel);
  const readOnly = activeScope === "managed";
  const PanelComponent = PANEL_COMPONENTS[activePanel];
  const supportedForProvider = panel ? panelSupportsProvider(panel, activeProvider) : true;

  if (isImmersiveMonitor) {
    return (
      <main className="flex flex-1 overflow-hidden">
        {PanelComponent && supportedForProvider ? (
          <PanelComponent />
        ) : (
          <PanelPlaceholder panelId={activePanel} />
        )}
      </main>
    );
  }

  return (
    <main className="flex flex-1 flex-col overflow-hidden">
      <PanelHeader
        title={panel?.label ?? ""}
        scope={isMonitor ? undefined : activeScope}
        readOnly={isMonitor ? false : readOnly}
      />
      <ScrollArea className="flex-1 p-6">
        {PanelComponent && supportedForProvider ? (
          <PanelComponent />
        ) : (
          <PanelPlaceholder panelId={activePanel} />
        )}
      </ScrollArea>
      {!isMonitor && activeProvider === "claude" && <EffectiveConfigFooter />}
    </main>
  );
}
