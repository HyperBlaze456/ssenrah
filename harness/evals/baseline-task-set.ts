export interface BaselineEvalTask {
  id: string;
  prompt: string;
  requiredKeywords: string[];
  weight: number;
}

/**
 * First baseline task set for regression scoring.
 * Keeps tasks small and deterministic so it can run in CI without live model calls.
 */
export const BASELINE_TASK_SET: BaselineEvalTask[] = [
  {
    id: "runtime-phase",
    prompt:
      "Describe why deterministic runtime phase transitions improve harness safety.",
    requiredKeywords: ["deterministic", "phase", "transition", "safety"],
    weight: 1,
  },
  {
    id: "policy-approval",
    prompt:
      "Explain when the harness should stop for user approval during tool execution.",
    requiredKeywords: ["approval", "risk", "await_user", "policy"],
    weight: 1,
  },
  {
    id: "intent-gate",
    prompt:
      "Summarize the intent declaration requirement before calling tools.",
    requiredKeywords: ["intent", "tool", "declaration", "blocked"],
    weight: 1,
  },
  {
    id: "fallback",
    prompt:
      "Explain how fallback retries should behave after a tool failure.",
    requiredKeywords: ["fallback", "retry", "failure", "summary"],
    weight: 1,
  },
  {
    id: "events",
    prompt: "Describe what should be logged for auditability in harness events.",
    requiredKeywords: ["event", "tool_call", "tool_result", "turn_result"],
    weight: 1,
  },
];

