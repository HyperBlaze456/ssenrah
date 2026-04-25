import { create } from "zustand";
import { exists, readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { homeDir, join } from "@tauri-apps/api/path";

export type EscalationCondition =
  | "session_cost_exceeds"
  | "error_count_exceeds"
  | "session_duration_exceeds";

export interface EscalationRule {
  name: string;
  condition: EscalationCondition | string;
  threshold: number;
  action: string;
}

interface EscalationStore {
  rules: EscalationRule[];
  loaded: boolean;
  loading: boolean;
  saving: boolean;
  error: string | null;

  load: () => Promise<void>;
  save: () => Promise<void>;
  setRules: (rules: EscalationRule[]) => void;
  updateThreshold: (index: number, threshold: number) => void;
}

const DEFAULT_RULES: EscalationRule[] = [
  { name: "High session cost", condition: "session_cost_exceeds", threshold: 5, action: "log" },
  { name: "Too many errors", condition: "error_count_exceeds", threshold: 10, action: "log" },
  { name: "Long-running session", condition: "session_duration_exceeds", threshold: 7200, action: "log" },
];

async function configPath(): Promise<string> {
  const home = await homeDir();
  return await join(home, ".ssenrah", "escalation.json");
}

export const useEscalationStore = create<EscalationStore>((set, get) => ({
  rules: [],
  loaded: false,
  loading: false,
  saving: false,
  error: null,

  load: async () => {
    if (get().loading) return;
    set({ loading: true, error: null });
    try {
      const path = await configPath();
      if (!(await exists(path))) {
        set({ rules: DEFAULT_RULES, loaded: true, loading: false });
        return;
      }
      const raw = await readTextFile(path);
      const parsed = JSON.parse(raw) as { rules?: EscalationRule[] };
      set({
        rules: Array.isArray(parsed.rules) ? parsed.rules : DEFAULT_RULES,
        loaded: true,
        loading: false,
      });
    } catch (err) {
      set({
        rules: DEFAULT_RULES,
        loaded: true,
        loading: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },

  save: async () => {
    set({ saving: true, error: null });
    try {
      const path = await configPath();
      await writeTextFile(path, JSON.stringify({ rules: get().rules }, null, 2) + "\n");
      set({ saving: false });
    } catch (err) {
      set({
        saving: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },

  setRules: (rules) => set({ rules }),

  updateThreshold: (index, threshold) =>
    set((state) => {
      const next = [...state.rules];
      const target = next[index];
      if (!target) return state;
      next[index] = { ...target, threshold };
      return { rules: next };
    }),
}));

export function findRuleByCondition(
  rules: EscalationRule[],
  condition: EscalationCondition,
): EscalationRule | undefined {
  return rules.find((rule) => rule.condition === condition);
}

export function getCostThreshold(rules: EscalationRule[]): number | null {
  const rule = findRuleByCondition(rules, "session_cost_exceeds");
  return rule ? rule.threshold : null;
}

export function getErrorThreshold(rules: EscalationRule[]): number | null {
  const rule = findRuleByCondition(rules, "error_count_exceeds");
  return rule ? rule.threshold : null;
}

export function getDurationThreshold(rules: EscalationRule[]): number | null {
  const rule = findRuleByCondition(rules, "session_duration_exceeds");
  return rule ? rule.threshold : null;
}
