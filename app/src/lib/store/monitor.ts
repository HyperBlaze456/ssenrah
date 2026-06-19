import { useMemo } from "react";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { readTextFile, exists } from "@tauri-apps/plugin-fs";
import { homeDir, join } from "@tauri-apps/api/path";
import type { AgentEvent, EventSummary, Provider, SessionSummary } from "@/types";
import { detectProvider } from "@/types";
import { useUiStore } from "@/lib/store/ui";
import { getAuthoritativeSessionCostSummary, getAuthoritativeTotalCost } from "@/lib/telemetry";

interface MonitorStore {
  events: AgentEvent[];
  loading: boolean;
  error: string | null;
  lastLoaded: number;
  autoRefresh: boolean;
  refreshInterval: ReturnType<typeof setInterval> | null;
  focusedSessionIds: string[];
  activeSessionId: string | null;
  showDismissedMonitorItems: boolean;
  dismissedAlertKeys: Record<string, true>;
  dismissedAnomalyKeys: Record<string, true>;

  loadEvents: () => Promise<void>;
  startAutoRefresh: (intervalMs?: number) => void;
  stopAutoRefresh: () => void;
  toggleFocusedSession: (sessionId: string) => void;
  focusSingleSession: (sessionId: string) => void;
  clearFocusedSessions: () => void;
  setActiveSessionId: (sessionId: string | null) => void;
  toggleShowDismissedMonitorItems: () => void;
  dismissAlert: (key: string) => void;
  dismissAlerts: (keys: string[]) => void;
  restoreAlert: (key: string) => void;
  restoreAlerts: (keys: string[]) => void;
  clearDismissedAlerts: () => void;
  dismissAnomaly: (key: string) => void;
  dismissAnomalies: (keys: string[]) => void;
  restoreAnomaly: (key: string) => void;
  restoreAnomalies: (keys: string[]) => void;
  clearDismissedAnomalies: () => void;
}

async function getEventsPath(): Promise<string> {
  const home = await homeDir();
  return await join(home, ".ssenrah", "events", "events.jsonl");
}

function parseJsonlEvents(content: string): AgentEvent[] {
  const events: AgentEvent[] = [];
  for (const line of content.split("\n")) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line) as AgentEvent);
    } catch {
      // Skip malformed lines
    }
  }
  return events;
}

/** Filter events down to a single harness/provider (`claude` or `codex`). */
export function filterEventsByProvider(events: AgentEvent[], provider: Provider): AgentEvent[] {
  return events.filter((event) => detectProvider(event) === provider);
}

/**
 * Subscribe to the harness-scoped event slice. Wraps `useMonitorStore` + `useUiStore`
 * so individual panels don't have to repeat the filtering boilerplate.
 */
export function useHarnessEvents(): AgentEvent[] {
  const events = useMonitorStore((state) => state.events);
  const provider = useUiStore((state) => state.activeProvider);
  return useMemo(() => filterEventsByProvider(events, provider), [events, provider]);
}

/** Counts of events per provider — used to drive the harness toggle UI. */
export function computeProviderCounts(events: AgentEvent[]): Record<Provider, number> {
  const counts: Record<Provider, number> = { claude: 0, codex: 0 };
  for (const event of events) {
    counts[detectProvider(event)] += 1;
  }
  return counts;
}

export function computeSummary(events: AgentEvent[]): EventSummary {
  if (events.length === 0) {
    return {
      total_events: 0,
      session_count: 0,
      tool_uses: 0,
      errors: 0,
      subagents: 0,
      tasks_completed: 0,
      total_cost: 0,
      first_event: null,
      last_event: null,
      top_tools: [],
    };
  }

  const sessions = new Set(events.map((event) => event.session_id));
  const toolUses = events.filter((event) => event.hook_event_type === "PostToolUse");
  const errors = events.filter(
    (event) =>
      event.hook_event_type === "PostToolUseFailure" ||
      event.hook_event_type === "StopFailure",
  );
  const subagents = events.filter(
    (event) => event.hook_event_type === "SubagentStart",
  );
  const tasks = events.filter((event) => event.hook_event_type === "TaskCompleted");
  const totalCost = getAuthoritativeTotalCost(events);

  const toolCounts = new Map<string, number>();
  for (const event of toolUses) {
    const name = event.tool_name ?? "unknown";
    toolCounts.set(name, (toolCounts.get(name) ?? 0) + 1);
  }
  const topTools = [...toolCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  return {
    total_events: events.length,
    session_count: sessions.size,
    tool_uses: toolUses.length,
    errors: errors.length,
    subagents: subagents.length,
    tasks_completed: tasks.length,
    total_cost: totalCost,
    first_event: events[0]!.timestamp,
    last_event: events[events.length - 1]!.timestamp,
    top_tools: topTools,
  };
}

export function computeSessions(events: AgentEvent[]): SessionSummary[] {
  const groupedSessions = new Map<
    string,
    {
      events: AgentEvent[];
      tools: Map<string, number>;
    }
  >();

  for (const event of events) {
    let grouped = groupedSessions.get(event.session_id);
    if (!grouped) {
      grouped = { events: [], tools: new Map() };
      groupedSessions.set(event.session_id, grouped);
    }
    grouped.events.push(event);
    if (event.hook_event_type === "PostToolUse" && event.tool_name) {
      grouped.tools.set(event.tool_name, (grouped.tools.get(event.tool_name) ?? 0) + 1);
    }
  }

  const sessions: SessionSummary[] = [];
  for (const [session_id, grouped] of groupedSessions) {
    const first = grouped.events[0]!;
    const last = grouped.events[grouped.events.length - 1]!;
    const duration =
      (new Date(last.timestamp).getTime() - new Date(first.timestamp).getTime()) /
      1000;

    const cost = getAuthoritativeSessionCostSummary(grouped.events, session_id);
    const usage = cost.token_usage;
    sessions.push({
      session_id,
      event_count: grouped.events.length,
      first_event: first.timestamp,
      last_event: last.timestamp,
      duration_seconds: Math.round(duration),
      tool_uses: grouped.events.filter((event) => event.hook_event_type === "PostToolUse")
        .length,
      errors: grouped.events.filter(
        (event) =>
          event.hook_event_type === "PostToolUseFailure" ||
          event.hook_event_type === "StopFailure",
      ).length,
      subagents: grouped.events.filter(
        (event) => event.hook_event_type === "SubagentStart",
      ).length,
      cost_usd: cost.cost_usd,
      cost_kind: cost.cost_kind,
      reported_cost_usd: cost.reported_cost_usd,
      ttft_ms: cost.ttft_ms,
      total_tokens: usage?.total_tokens,
      input_tokens: usage?.input_tokens,
      output_tokens: usage?.output_tokens,
      cache_read_input_tokens: usage?.cache_read_input_tokens,
      cache_creation_input_tokens: usage?.cache_creation_input_tokens,
      reasoning_output_tokens: usage?.reasoning_output_tokens,
      web_search_requests: usage?.web_search_requests,
      service_tier: usage?.service_tier,
      top_tools: [...grouped.tools.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5),
    });
  }

  sessions.sort(
    (a, b) =>
      new Date(b.first_event).getTime() - new Date(a.first_event).getTime(),
  );

  return sessions;
}

export const useMonitorStore = create<MonitorStore>()(
  persist(
    (set, get) => ({
      events: [],
      loading: false,
      error: null,
      lastLoaded: 0,
      autoRefresh: false,
      refreshInterval: null,
      focusedSessionIds: [],
      activeSessionId: null,
      showDismissedMonitorItems: false,
      dismissedAlertKeys: {},
      dismissedAnomalyKeys: {},

      loadEvents: async () => {
        try {
          set({ loading: true, error: null });
          const path = await getEventsPath();
          const fileExists = await exists(path);
          if (!fileExists) {
            set({ events: [], loading: false, lastLoaded: Date.now() });
            return;
          }
          const content = await readTextFile(path);
          const events = parseJsonlEvents(content);
          set({ events, loading: false, lastLoaded: Date.now() });
        } catch (err) {
          set({
            error: err instanceof Error ? err.message : String(err),
            loading: false,
          });
        }
      },

      startAutoRefresh: (intervalMs = 2000) => {
        const { refreshInterval } = get();
        if (refreshInterval) return;
        get().loadEvents();
        const interval = setInterval(() => get().loadEvents(), intervalMs);
        set({ autoRefresh: true, refreshInterval: interval });
      },

      stopAutoRefresh: () => {
        const { refreshInterval } = get();
        if (refreshInterval) {
          clearInterval(refreshInterval);
        }
        set({ autoRefresh: false, refreshInterval: null });
      },

      toggleFocusedSession: (sessionId) =>
        set((state) => ({
          focusedSessionIds: state.focusedSessionIds.includes(sessionId)
            ? state.focusedSessionIds.filter((id) => id !== sessionId)
            : [...state.focusedSessionIds, sessionId],
        })),

      focusSingleSession: (sessionId) => set({ focusedSessionIds: [sessionId] }),
      clearFocusedSessions: () => set({ focusedSessionIds: [] }),
      setActiveSessionId: (sessionId) => set({ activeSessionId: sessionId }),
      toggleShowDismissedMonitorItems: () =>
        set((state) => ({
          showDismissedMonitorItems: !state.showDismissedMonitorItems,
        })),

      dismissAlert: (key) =>
        set((state) => ({
          dismissedAlertKeys: { ...state.dismissedAlertKeys, [key]: true },
        })),
      dismissAlerts: (keys) =>
        set((state) => ({
          dismissedAlertKeys: keys.reduce<Record<string, true>>(
            (next, key) => {
              next[key] = true;
              return next;
            },
            { ...state.dismissedAlertKeys },
          ),
        })),
      restoreAlert: (key) =>
        set((state) => {
          const next = { ...state.dismissedAlertKeys };
          delete next[key];
          return { dismissedAlertKeys: next };
        }),
      restoreAlerts: (keys) =>
        set((state) => {
          const next = { ...state.dismissedAlertKeys };
          for (const key of keys) {
            delete next[key];
          }
          return { dismissedAlertKeys: next };
        }),
      clearDismissedAlerts: () => set({ dismissedAlertKeys: {} }),

      dismissAnomaly: (key) =>
        set((state) => ({
          dismissedAnomalyKeys: { ...state.dismissedAnomalyKeys, [key]: true },
        })),
      dismissAnomalies: (keys) =>
        set((state) => ({
          dismissedAnomalyKeys: keys.reduce<Record<string, true>>(
            (next, key) => {
              next[key] = true;
              return next;
            },
            { ...state.dismissedAnomalyKeys },
          ),
        })),
      restoreAnomaly: (key) =>
        set((state) => {
          const next = { ...state.dismissedAnomalyKeys };
          delete next[key];
          return { dismissedAnomalyKeys: next };
        }),
      restoreAnomalies: (keys) =>
        set((state) => {
          const next = { ...state.dismissedAnomalyKeys };
          for (const key of keys) {
            delete next[key];
          }
          return { dismissedAnomalyKeys: next };
        }),
      clearDismissedAnomalies: () => set({ dismissedAnomalyKeys: {} }),
    }),
    {
      name: "ssenrah-monitor-ui",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        focusedSessionIds: state.focusedSessionIds,
        activeSessionId: state.activeSessionId,
        showDismissedMonitorItems: state.showDismissedMonitorItems,
        dismissedAlertKeys: state.dismissedAlertKeys,
        dismissedAnomalyKeys: state.dismissedAnomalyKeys,
      }),
    },
  ),
);
