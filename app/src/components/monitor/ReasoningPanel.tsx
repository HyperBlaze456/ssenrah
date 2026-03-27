import { useEffect, useState } from "react";
import { useMonitorStore } from "@/lib/store/monitor";
import { readTextFile, exists } from "@tauri-apps/plugin-fs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Brain, MessageSquare, Wrench, User, AlertCircle } from "lucide-react";

interface ToolDecision {
  tool_name: string;
  tool_input: Record<string, unknown>;
  tool_use_id: string;
}

interface ReasoningStep {
  timestamp: string;
  model: string;
  thinking?: string;
  reasoning?: string;
  decisions: ToolDecision[];
}

interface UserPrompt {
  timestamp: string;
  content: string;
}

interface DecisionChain {
  session_id: string;
  steps: ReasoningStep[];
  prompts: UserPrompt[];
  summary: {
    total_turns: number;
    total_thinking_blocks: number;
    total_reasoning_blocks: number;
    total_decisions: number;
    total_user_prompts: number;
    models_used: string[];
  };
}

interface TranscriptEntry {
  type: string;
  sessionId?: string;
  timestamp?: string;
  message?: {
    id?: string;
    model?: string;
    role?: string;
    content?: Array<{
      type: string;
      text?: string;
      thinking?: string;
      name?: string;
      id?: string;
      input?: Record<string, unknown>;
    }>;
  };
}

function extractChain(entries: TranscriptEntry[]): DecisionChain | null {
  const sessionId = entries.find((e) => e.sessionId)?.sessionId ?? "unknown";

  // Group assistant messages by message.id
  const turns = new Map<string, TranscriptEntry[]>();
  for (const entry of entries) {
    if (entry.type !== "assistant") continue;
    const msgId = entry.message?.id;
    if (!msgId) continue;
    const group = turns.get(msgId);
    if (group) group.push(entry);
    else turns.set(msgId, [entry]);
  }

  const steps: ReasoningStep[] = [];
  for (const [, group] of turns) {
    const first = group[0]!;
    const model = first.message?.model ?? "unknown";
    const timestamp = (first.timestamp as string) ?? "";

    let thinking: string | undefined;
    let reasoning: string | undefined;
    const decisions: ToolDecision[] = [];

    for (const entry of group) {
      for (const block of entry.message?.content ?? []) {
        if (block.type === "thinking" && block.thinking) {
          thinking = thinking ? thinking + "\n" + block.thinking : block.thinking;
        } else if (block.type === "text" && block.text) {
          reasoning = reasoning ? reasoning + "\n" + block.text : block.text;
        } else if (block.type === "tool_use" && block.name) {
          decisions.push({
            tool_name: block.name,
            tool_input: block.input ?? {},
            tool_use_id: block.id ?? "",
          });
        }
      }
    }

    if (thinking || reasoning || decisions.length > 0) {
      steps.push({ timestamp, model, thinking, reasoning, decisions });
    }
  }

  // Extract user prompts
  const prompts: UserPrompt[] = [];
  for (const entry of entries) {
    if (entry.type !== "user") continue;
    const msg = entry.message;
    let content = "";
    if (typeof msg?.content === "string") content = msg.content;
    else if (Array.isArray(msg?.content)) {
      content = msg!.content
        .filter((b) => b.type === "text" && b.text)
        .map((b) => b.text)
        .join("\n");
    }
    if (content.trim()) {
      prompts.push({ timestamp: entry.timestamp ?? "", content: content.trim() });
    }
  }

  const modelsUsed = [...new Set(steps.map((s) => s.model).filter((m) => m !== "unknown"))];

  return {
    session_id: sessionId,
    steps,
    prompts,
    summary: {
      total_turns: steps.length,
      total_thinking_blocks: steps.filter((s) => s.thinking).length,
      total_reasoning_blocks: steps.filter((s) => s.reasoning).length,
      total_decisions: steps.reduce((n, s) => n + s.decisions.length, 0),
      total_user_prompts: prompts.length,
      models_used: modelsUsed,
    },
  };
}

function formatTime(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max - 1) + "…" : str;
}

export function ReasoningPanel() {
  const events = useMonitorStore((s) => s.events);
  const loading = useMonitorStore((s) => s.loading);
  const error = useMonitorStore((s) => s.error);
  const startAutoRefresh = useMonitorStore((s) => s.startAutoRefresh);
  const stopAutoRefresh = useMonitorStore((s) => s.stopAutoRefresh);

  const [chain, setChain] = useState<DecisionChain | null>(null);
  const [chainLoading, setChainLoading] = useState(false);

  useEffect(() => {
    startAutoRefresh(10000);
    return () => stopAutoRefresh();
  }, [startAutoRefresh, stopAutoRefresh]);

  // Find most recent session's transcript and parse it
  useEffect(() => {
    if (events.length === 0) return;

    const sessionTranscripts = new Map<string, string>();
    for (const e of events) {
      const raw = e._raw as Record<string, unknown> | undefined;
      if (raw?.transcript_path && typeof raw.transcript_path === "string") {
        sessionTranscripts.set(e.session_id, raw.transcript_path);
      }
    }

    // Use most recent session
    const entries = [...sessionTranscripts.entries()];
    if (entries.length === 0) return;

    const [, transcriptPath] = entries[entries.length - 1]!;

    setChainLoading(true);
    (async () => {
      try {
        const fileExists = await exists(transcriptPath);
        if (!fileExists) {
          setChain(null);
          setChainLoading(false);
          return;
        }
        const content = await readTextFile(transcriptPath);
        const lines = content.split("\n").filter(Boolean);
        const parsed: TranscriptEntry[] = [];
        for (const line of lines) {
          try { parsed.push(JSON.parse(line)); } catch { /* skip */ }
        }
        setChain(extractChain(parsed));
      } catch {
        setChain(null);
      }
      setChainLoading(false);
    })();
  }, [events]);

  if (error) {
    return (
      <div className="p-4 text-destructive">
        <AlertCircle className="inline h-4 w-4 mr-2" />
        Failed to load data: {error}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary */}
      {chain && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Turns</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{chain.summary.total_turns}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Thinking</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{chain.summary.total_thinking_blocks}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Reasoning</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{chain.summary.total_reasoning_blocks}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Decisions</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{chain.summary.total_decisions}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Models</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-1">
                {chain.summary.models_used.map((m) => (
                  <Badge key={m} variant="outline" className="text-[10px]">{m}</Badge>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Decision chain feed */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Brain className="h-4 w-4" />
              Decision Chain
              {(loading || chainLoading) && (
                <span className="text-xs text-muted-foreground animate-pulse">loading...</span>
              )}
            </CardTitle>
            {chain && (
              <span className="text-xs text-muted-foreground font-mono">
                {chain.session_id.slice(0, 8)}
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {!chain && !chainLoading && (
            <p className="text-sm text-muted-foreground py-8 text-center">
              No transcript data available. Reasoning chains appear after sessions with transcript data.
            </p>
          )}

          {chain && (() => {
            // Interleave prompts and steps chronologically
            const items: Array<{ ts: string; type: "prompt" | "step"; idx: number }> = [];
            chain.prompts.forEach((p, i) => items.push({ ts: p.timestamp, type: "prompt", idx: i }));
            chain.steps.forEach((s, i) => items.push({ ts: s.timestamp, type: "step", idx: i }));
            items.sort((a, b) => a.ts.localeCompare(b.ts));

            // Show last 30 items
            const recent = items.slice(-30);

            return (
              <div className="space-y-3">
                {recent.map((item, i) => {
                  if (item.type === "prompt") {
                    const p = chain.prompts[item.idx]!;
                    return (
                      <div key={`p-${i}`} className="flex items-start gap-3 rounded-md bg-blue-500/5 border border-blue-500/10 px-3 py-2">
                        <User className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm">{truncate(p.content, 200)}</p>
                        </div>
                        <span className="text-[10px] text-muted-foreground shrink-0">{formatTime(p.timestamp)}</span>
                      </div>
                    );
                  }

                  const step = chain.steps[item.idx]!;
                  return (
                    <div key={`s-${i}`} className="rounded-md border px-3 py-2 space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-[10px]">{step.model}</Badge>
                          <span className="text-[10px] text-muted-foreground">Turn {item.idx + 1}</span>
                        </div>
                        <span className="text-[10px] text-muted-foreground">{formatTime(step.timestamp)}</span>
                      </div>

                      {step.thinking && (
                        <div className="flex items-start gap-2">
                          <Brain className="h-3.5 w-3.5 text-purple-500 shrink-0 mt-0.5" />
                          <p className="text-xs text-muted-foreground">{truncate(step.thinking, 300)}</p>
                        </div>
                      )}

                      {step.reasoning && (
                        <div className="flex items-start gap-2">
                          <MessageSquare className="h-3.5 w-3.5 text-green-500 shrink-0 mt-0.5" />
                          <p className="text-sm">{truncate(step.reasoning, 300)}</p>
                        </div>
                      )}

                      {step.decisions.length > 0 && (
                        <div className="space-y-1">
                          {step.decisions.map((d, di) => (
                            <div key={di} className="flex items-center gap-2">
                              <Wrench className="h-3.5 w-3.5 text-orange-500 shrink-0" />
                              <Badge variant="secondary" className="text-[10px]">{d.tool_name}</Badge>
                              <span className="text-[10px] text-muted-foreground truncate">
                                {truncate(JSON.stringify(d.tool_input), 80)}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </CardContent>
      </Card>
    </div>
  );
}
