import { create } from "zustand";
import { readTextFile, exists } from "@tauri-apps/plugin-fs";
import { homeDir, join } from "@tauri-apps/api/path";
import type { AgentEvent, EventSummary, SessionSummary } from "@/types";

interface MonitorStore {
  events: AgentEvent[];
  loading: boolean;
  error: string | null;
  lastLoaded: number;
  autoRefresh: boolean;
  refreshInterval: ReturnType<typeof setInterval> | null;

  loadEvents: () => Promise<void>;
  startAutoRefresh: (intervalMs?: number) => void;
  stopAutoRefresh: () => void;
  getSummary: () => EventSummary;
  getSessions: () => SessionSummary[];
  getAlerts: () => AgentEvent[];
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

function computeSummary(events: AgentEvent[]): EventSummary {
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

  const sessions = new Set(events.map((e) => e.session_id));
  const toolUses = events.filter((e) => e.hook_event_type === "PostToolUse");
  const errors = events.filter(
    (e) =>
      e.hook_event_type === "PostToolUseFailure" ||
      e.hook_event_type === "StopFailure"
  );
  const subagents = events.filter(
    (e) => e.hook_event_type === "SubagentStart"
  );
  const tasks = events.filter((e) => e.hook_event_type === "TaskCompleted");
  const totalCost = events.reduce((sum, e) => sum + (e.cost_usd ?? 0), 0);

  const toolCounts = new Map<string, number>();
  for (const e of toolUses) {
    const name = e.tool_name ?? "unknown";
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

function computeSessions(events: AgentEvent[]): SessionSummary[] {
  const map = new Map<
    string,
    {
      events: AgentEvent[];
      tools: Map<string, number>;
    }
  >();

  for (const e of events) {
    let s = map.get(e.session_id);
    if (!s) {
      s = { events: [], tools: new Map() };
      map.set(e.session_id, s);
    }
    s.events.push(e);
    if (e.hook_event_type === "PostToolUse" && e.tool_name) {
      s.tools.set(e.tool_name, (s.tools.get(e.tool_name) ?? 0) + 1);
    }
  }

  const sessions: SessionSummary[] = [];
  for (const [session_id, s] of map) {
    const first = s.events[0]!;
    const last = s.events[s.events.length - 1]!;
    const duration =
      (new Date(last.timestamp).getTime() -
        new Date(first.timestamp).getTime()) /
      1000;

    sessions.push({
      session_id,
      event_count: s.events.length,
      first_event: first.timestamp,
      last_event: last.timestamp,
      duration_seconds: Math.round(duration),
      tool_uses: s.events.filter((e) => e.hook_event_type === "PostToolUse")
        .length,
      errors: s.events.filter(
        (e) =>
          e.hook_event_type === "PostToolUseFailure" ||
          e.hook_event_type === "StopFailure"
      ).length,
      subagents: s.events.filter(
        (e) => e.hook_event_type === "SubagentStart"
      ).length,
      cost_usd: s.events.reduce((sum, e) => sum + (e.cost_usd ?? 0), 0),
      top_tools: [...s.tools.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5),
    });
  }

  // Most recent first
  sessions.sort(
    (a, b) =>
      new Date(b.first_event).getTime() - new Date(a.first_event).getTime()
  );

  return sessions;
}

export const useMonitorStore = create<MonitorStore>((set, get) => ({
  events: [],
  loading: false,
  error: null,
  lastLoaded: 0,
  autoRefresh: false,
  refreshInterval: null,

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
    if (refreshInterval) return; // Already running
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

  getSummary: () => computeSummary(get().events),
  getSessions: () => computeSessions(get().events),
  getAlerts: () =>
    get().events.filter((e) => e.hook_event_type === "_escalation"),
}));
