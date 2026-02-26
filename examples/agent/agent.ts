import {
  LLMProvider,
  ChatContentBlock,
  ChatResponse,
} from "../providers/types";
import {
  AgentConfig,
  AgentRunHook,
  AgentRunSettings,
  Message,
  RunOptions,
  ToolDefinition,
  ToolRegistry,
  TurnResult,
} from "./types";
import { defaultTools } from "./tools";
import {
  parseIntents,
  validateIntents,
  getIntentSystemPrompt,
  IntentDeclaration,
} from "../harness/intent";
import { FallbackAgent } from "../harness/fallback";
import { Beholder, BeholderVerdict } from "../harness/beholder";
import { EventLogger } from "../harness/events";
import { createCheckpoint, saveCheckpoint } from "../harness/checkpoints";
import { ApprovalHandler, PolicyEngine, RiskLevel } from "../harness/policy-engine";
import os from "os";
import path from "path";

const DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_MAX_TURNS = 20;
const DEFAULT_SYSTEM = `You are a helpful AI agent. You have access to tools that let you
interact with the filesystem and complete tasks autonomously. Think step by step,
use tools when needed, and produce clear results.`;

/**
 * Agent — an LLM, a loop, and enough tokens.
 *
 * Architecture follows https://ampcode.com/notes/how-to-build-an-agent:
 *   1. Accept user message
 *   2. Send full conversation history to the LLM provider
 *   3. Provider responds with text and/or tool calls
 *   4. Execute every requested tool
 *   5. Append tool results and loop
 *   6. Stop when provider returns a pure text response (no tool calls)
 *
 * Now provider-agnostic — works with Anthropic, Gemini, OpenAI, or any LLMProvider.
 */
export class Agent {
  private provider: LLMProvider;
  private model: string;
  private maxTokens: number;
  private maxTurns: number;
  private systemPrompt: string;
  private tools: ToolDefinition[];
  private toolRegistry?: ToolRegistry;
  private hooks: AgentRunHook[];
  private signal?: AbortSignal;
  private sessionId: string;
  private checkpointBaseDir?: string;
  private checkpointEnabled: boolean;
  private intentRequired: boolean;
  private fallbackAgent?: FallbackAgent;
  private beholder?: Beholder;
  private eventLogger: EventLogger;
  private policyEngine: PolicyEngine;
  private approvalHandler?: ApprovalHandler;
  private history: Message[] = [];

  constructor(config: AgentConfig) {
    this.provider = config.provider;
    this.model = config.model;
    this.maxTokens = config.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.maxTurns = config.maxTurns ?? DEFAULT_MAX_TURNS;
    this.toolRegistry = config.toolRegistry;
    this.tools = this.resolveConfiguredTools(config);
    this.hooks = config.hooks ?? [];
    this.signal = config.signal;
    this.sessionId = resolveSessionId(config.sessionId);
    this.checkpointBaseDir = config.checkpointBaseDir;
    this.checkpointEnabled =
      config.checkpointEnabled ?? Boolean(config.sessionId?.trim());
    this.intentRequired = config.intentRequired ?? true;
    this.eventLogger = new EventLogger({
      filePath: config.eventLogPath ?? defaultEventLogPath(this.sessionId),
    });

    // Build system prompt — append intent instructions if required
    let system = config.systemPrompt ?? DEFAULT_SYSTEM;
    if (this.intentRequired) {
      system += "\n\n" + getIntentSystemPrompt();
    }
    this.systemPrompt = system;

    // Set up fallback agent if a fallback provider is configured
    if (config.fallbackProvider) {
    this.fallbackAgent = new FallbackAgent({
        provider: config.fallbackProvider,
        model: config.fallbackModel ?? config.model,
        maxRetries: 3,
      });
    }
    this.policyEngine =
      config.policyEngine ??
      new PolicyEngine({
        profile: config.policyProfile,
        maxToolCalls: config.policyMaxToolCalls,
      });
    this.approvalHandler = config.approvalHandler;
  }

  /** Attach a Beholder overseer to monitor this agent. */
  setBeholder(beholder: Beholder): void {
    this.beholder = beholder;
  }

  /** Get the event logger for this agent. */
  getEventLogger(): EventLogger {
    return this.eventLogger;
  }

  /** Expose the conversation history (read-only snapshot). */
  getHistory(): Message[] {
    return [...this.history];
  }

  /** Clear conversation history (start a new context). */
  clearHistory(): void {
    this.history = [];
  }

  /**
   * Run one user turn through the agent loop.
   *
   * The loop continues calling the provider and executing tools until:
   *   - Provider returns end_turn with no tool calls, OR
   *   - maxTurns is reached (safety guard against runaway loops)
   */
  async run(userMessage: string, options?: RunOptions): Promise<TurnResult> {
    const runSettings: AgentRunSettings = {
      model: this.model,
      systemPrompt: this.systemPrompt,
      tools: this.tools.map((tool) => tool),
    };

    for (const hook of this.hooks) {
      await hook({
        userMessage,
        settings: runSettings,
        history: this.getHistory(),
        toolRegistry: this.toolRegistry,
      });
    }

    const activeModel = runSettings.model.trim();
    if (!activeModel) {
      throw new Error("Agent run model cannot be empty after hooks");
    }
    const activeSystemPrompt = runSettings.systemPrompt;
    const activeTools = dedupeToolsByName(runSettings.tools);

    this.history.push({ role: "user", content: userMessage });

    const toolsUsed: string[] = [];
    let finalResponse = "";
    let turns = 0;
    let completedNormally = false;
    const totalUsage = { inputTokens: 0, outputTokens: 0 };
    const finalizeTurn = (
      status: TurnResult["status"],
      response: string,
      reason?: string
    ): TurnResult => {
      const done = status === "completed";
      const phase =
        status === "completed"
          ? "completed"
          : status === "await_user"
            ? "await_user"
            : "failed";
      const result: TurnResult = {
        status,
        response,
        toolsUsed,
        usage: totalUsage,
        done,
        phase,
        reason,
      };
      this.eventLogger.log({
        timestamp: new Date().toISOString(),
        type: "turn_result",
        agentId: "agent",
        data: {
          status: result.status,
          phase: result.phase,
          done: result.done,
          reason: result.reason,
        },
      });
      this.persistTerminalCheckpoint({
        userMessage,
        result,
        toolsUsed,
        usage: totalUsage,
      });
      return result;
    };

    while (turns < this.maxTurns) {
      // Check for external cancellation before each API call
      if (this.signal?.aborted) {
        return finalizeTurn(
          "cancelled",
          finalResponse || "(agent cancelled)",
          "signal_aborted"
        );
      }

      turns++;

      const toolSchemas = activeTools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      }));

      let streamedByProvider = false;
      const request = {
        model: activeModel,
        systemPrompt: activeSystemPrompt,
        messages: [...this.history],
        tools: toolSchemas,
        maxTokens: this.maxTokens,
        signal: this.signal,
      };
      const response: ChatResponse =
        options?.stream && this.provider.chatStream
          ? await this.provider.chatStream(request, {
              onTextDelta: (delta) => {
                streamedByProvider = true;
                options?.onTextDelta?.(delta);
              },
            })
          : await this.provider.chat(request);

      if (
        options?.stream &&
        !streamedByProvider &&
        response.textBlocks.length > 0
      ) {
        for (const block of response.textBlocks) {
          options.onTextDelta?.(block);
        }
      }
      if (response.usage) {
        totalUsage.inputTokens += response.usage.inputTokens;
        totalUsage.outputTokens += response.usage.outputTokens;
      }

      // Build assistant message from response
      const assistantBlocks: ChatContentBlock[] = [];

      for (const text of response.textBlocks) {
        assistantBlocks.push({ type: "text", text });
      }
      for (const tc of response.toolCalls) {
        assistantBlocks.push({
          type: "tool_use",
          id: tc.id,
          name: tc.name,
          input: tc.input,
        });
      }

      this.history.push({ role: "assistant", content: assistantBlocks });

      if (response.textBlocks.length > 0) {
        finalResponse = response.textBlocks.join("\n");
      }

      // Handle non-terminal stop reasons
      if (response.stopReason === "max_tokens") {
        return finalizeTurn(
          "max_tokens",
          finalResponse || "(response truncated by max_tokens)",
          "provider_max_tokens"
        );
      }

      // No tool calls → done
      if (response.toolCalls.length === 0) {
        completedNormally = true;
        break;
      }

      // Parse intents from text if intent gate is enabled
      let intents: IntentDeclaration[] = [];
      if (this.intentRequired) {
        const fullText = response.textBlocks.join("\n");
        intents = parseIntents(fullText);

        const validation = validateIntents(intents, response.toolCalls);
        if (!validation.valid) {
          // Block unmatched tool calls — return error to agent
          const unmatchedNames = validation.unmatched
            .map((tc) => tc.name)
            .join(", ");
          const errorBlocks: ChatContentBlock[] = validation.unmatched.map(
            (tc) => ({
              type: "tool_result" as const,
              toolUseId: tc.id,
              content: `Error: tool call "${tc.name}" blocked — no intent declaration found. You must declare intent before using tools.`,
              isError: true,
            })
          );
          this.history.push({ role: "user", content: errorBlocks });

          this.eventLogger.log({
            timestamp: new Date().toISOString(),
            type: "error",
            agentId: "agent",
            data: { reason: "intent_gate_blocked", unmatchedTools: unmatchedNames },
          });
          continue;
        }

        // Log intents
        for (const intent of intents) {
          this.eventLogger.log({
            timestamp: new Date().toISOString(),
            type: "intent",
            agentId: "agent",
            data: intent as unknown as Record<string, unknown>,
          });
        }
      }

      // Execute each tool call and collect results
      const toolResultBlocks: ChatContentBlock[] = [];
      for (const tc of response.toolCalls) {
        // Check abort before each tool
        if (this.signal?.aborted) {
          return finalizeTurn(
            "cancelled",
            finalResponse || "(agent cancelled during tool execution)",
            "signal_aborted"
          );
        }

        const matchedIntent = intents.find((intent) => intent.toolName === tc.name);
        const inferredRisk: RiskLevel = matchedIntent?.riskLevel ?? "exec";
        const policyDecision = await this.policyEngine.evaluateToolCall(
          {
            toolName: tc.name,
            riskLevel: inferredRisk,
            toolCallCount: toolsUsed.length + 1,
          },
          this.approvalHandler
        );

        this.eventLogger.log({
          timestamp: new Date().toISOString(),
          type: "policy",
          agentId: "agent",
          data: {
            tool: tc.name,
            riskLevel: inferredRisk,
            action: policyDecision.action,
            reason: policyDecision.reason,
          },
        });

        if (policyDecision.action === "await_user") {
          return finalizeTurn(
            "await_user",
            finalResponse || `(approval required before running "${tc.name}")`,
            "policy_await_user"
          );
        }

        if (policyDecision.action === "deny") {
          this.eventLogger.log({
            timestamp: new Date().toISOString(),
            type: "error",
            agentId: "agent",
            data: {
              reason: "policy_denied",
              tool: tc.name,
              riskLevel: inferredRisk,
              policyReason: policyDecision.reason,
            },
          });
          return finalizeTurn(
            "failed",
            finalResponse ||
              `Tool "${tc.name}" denied by policy: ${policyDecision.reason}`,
            "policy_denied"
          );
        }

        // Beholder check
        if (this.beholder) {
          const intent = matchedIntent ?? {
            toolName: tc.name,
            purpose: "unknown",
            expectedOutcome: "unknown",
            riskLevel: "read" as const,
            timestamp: new Date().toISOString(),
          };

          const verdict: BeholderVerdict = await this.beholder.evaluate(
            intent,
            tc,
            response.usage
          );

          this.eventLogger.log({
            timestamp: new Date().toISOString(),
            type: "beholder_action",
            agentId: "agent",
            data: { action: verdict.action, reason: verdict.reason },
          });

          if (verdict.action === "kill") {
            return finalizeTurn(
              "failed",
              `(agent killed by Beholder: ${verdict.reason})`,
              "beholder_kill"
            );
          }
          // "pause" and "warn" are logged but don't stop execution in autonomous mode
        }

        toolsUsed.push(tc.name);

        this.eventLogger.log({
          timestamp: new Date().toISOString(),
          type: "tool_call",
          agentId: "agent",
          data: { tool: tc.name, input: tc.input },
        });

        const tool = activeTools.find((t) => t.name === tc.name);
        let content: string;
        let isError = false;

        if (!tool) {
          content = `Unknown tool: "${tc.name}"`;
          isError = true;
        } else {
          try {
            content = await tool.run(tc.input);
            if (content.startsWith("Error")) isError = true;
          } catch (err) {
            content = `Tool "${tc.name}" threw: ${(err as Error).message}`;
            isError = true;
          }
        }

        // If tool failed and we have a fallback agent, try recovery
        if (isError && this.fallbackAgent && tool) {
          const intent = intents.find((i) => i.toolName === tc.name) ?? {
            toolName: tc.name,
            purpose: "execute tool",
            expectedOutcome: "success",
            riskLevel: "read" as const,
            timestamp: new Date().toISOString(),
          };

          this.eventLogger.log({
            timestamp: new Date().toISOString(),
            type: "fallback",
            agentId: "agent",
            data: { tool: tc.name, originalError: content },
          });

          const fallbackResult = await this.fallbackAgent.handleFailure(
            tc,
            content,
            intent,
            activeTools
          );

          if (fallbackResult.resolved && fallbackResult.result) {
            content = fallbackResult.result;
            isError = false;
          }
        }

        this.eventLogger.log({
          timestamp: new Date().toISOString(),
          type: "tool_result",
          agentId: "agent",
          data: { tool: tc.name, isError, contentLength: content.length },
        });

        toolResultBlocks.push({
          type: "tool_result",
          toolUseId: tc.id,
          name: tc.name,
          content,
          isError,
        });
      }

      // Feed tool results back as a user message
      this.history.push({ role: "user", content: toolResultBlocks });
    }

    if (completedNormally) {
      return finalizeTurn("completed", finalResponse);
    }

    if (turns >= this.maxTurns) {
      return finalizeTurn(
        "max_turns",
        finalResponse || "(agent stopped: max turns reached)",
        "max_turns_reached"
      );
    }

    return finalizeTurn("completed", finalResponse);
  }

  private resolveConfiguredTools(config: AgentConfig): ToolDefinition[] {
    if (config.tools) {
      return dedupeToolsByName(config.tools);
    }

    if (config.toolPacks && config.toolPacks.length > 0) {
      if (!config.toolRegistry) {
        throw new Error(
          "AgentConfig.toolPacks requires AgentConfig.toolRegistry"
        );
      }
      return dedupeToolsByName(config.toolRegistry.resolvePacks(config.toolPacks));
    }

    return dedupeToolsByName(defaultTools);
  }

  private persistTerminalCheckpoint(input: {
    userMessage: string;
    result: TurnResult;
    toolsUsed: string[];
    usage: { inputTokens: number; outputTokens: number };
  }): void {
    if (!this.checkpointEnabled) return;

    try {
      const checkpointId = `${Date.now()}-${input.result.status}`;
      const checkpoint = createCheckpoint({
        checkpointId,
        phase: input.result.phase,
        goal: input.userMessage,
        summary: truncateCheckpointSummary(input.result.response),
        policyProfile: this.policyEngine.profile,
        metadata: {
          status: input.result.status,
          reason: input.result.reason,
          toolsUsed: [...input.toolsUsed],
          usage: { ...input.usage },
        },
      });
      saveCheckpoint(checkpoint, {
        baseDir: this.checkpointBaseDir,
        sessionId: this.sessionId,
      });
    } catch (err) {
      this.eventLogger.log({
        timestamp: new Date().toISOString(),
        type: "error",
        agentId: "agent",
        data: {
          reason: "checkpoint_save_failed",
          message: (err as Error).message,
        },
      });
    }
  }
}

function defaultEventLogPath(sessionId: string): string {
  return path.join(
    os.homedir(),
    ".ssenrah",
    "sessions",
    sessionId,
    "events.jsonl"
  );
}

function resolveSessionId(sessionId?: string): string {
  if (sessionId && sessionId.trim() !== "") {
    return sanitizeSessionId(sessionId);
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function sanitizeSessionId(sessionId: string): string {
  const trimmed = sessionId.trim();
  if (!trimmed) {
    throw new Error("sessionId must be non-empty");
  }
  if (trimmed === "." || trimmed === "..") {
    throw new Error("sessionId cannot be '.' or '..'");
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(trimmed)) {
    throw new Error(
      "sessionId may contain only letters, numbers, dot, underscore, or hyphen"
    );
  }
  return trimmed;
}

function truncateCheckpointSummary(text: string): string | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  const max = 500;
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`;
}

function dedupeToolsByName(tools: ToolDefinition[]): ToolDefinition[] {
  const byName = new Map<string, ToolDefinition>();
  for (const tool of tools) {
    byName.set(tool.name, tool);
  }
  return Array.from(byName.values());
}
