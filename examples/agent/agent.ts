import Anthropic from "@anthropic-ai/sdk";
import { AgentConfig, Message, ToolDefinition, TurnResult } from "./types";
import { defaultTools } from "./tools";

const DEFAULT_MODEL = "claude-opus-4-6";
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
 *   2. Send full conversation history to Claude
 *   3. Claude responds with text and/or tool_use blocks
 *   4. Execute every requested tool
 *   5. Append tool_result messages and loop
 *   6. Stop when Claude returns a pure text response (no tool calls)
 */
export class Agent {
  private client: Anthropic;
  private model: string;
  private maxTokens: number;
  private maxTurns: number;
  private systemPrompt: string;
  private tools: ToolDefinition[];
  private signal?: AbortSignal;
  private history: Message[] = [];

  constructor(config: AgentConfig = {}) {
    this.client = new Anthropic();
    this.model = config.model ?? DEFAULT_MODEL;
    this.maxTokens = config.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.maxTurns = config.maxTurns ?? DEFAULT_MAX_TURNS;
    this.systemPrompt = config.systemPrompt ?? DEFAULT_SYSTEM;
    this.tools = config.tools ?? defaultTools;
    this.signal = config.signal;
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
   * The loop continues calling Claude and executing tools until:
   *   - Claude returns end_turn with no tool_use blocks, OR
   *   - maxTurns is reached (safety guard against runaway loops)
   */
  async run(userMessage: string): Promise<TurnResult> {
    this.history.push({ role: "user", content: userMessage });

    const toolsUsed: string[] = [];
    let finalResponse = "";
    let turns = 0;

    while (turns < this.maxTurns) {
      // Check for external cancellation before each API call
      if (this.signal?.aborted) {
        return {
          response: finalResponse || "(agent cancelled)",
          toolsUsed,
          done: false,
        };
      }

      turns++;

      const response = await this.client.messages.create(
        {
          model: this.model,
          max_tokens: this.maxTokens,
          system: this.systemPrompt,
          tools: this.tools.map((t) => ({
            name: t.name,
            description: t.description,
            input_schema: t.inputSchema,
          })),
          messages: this.history,
        },
        // Pass AbortSignal to the SDK so in-flight HTTP is cancelled too
        { signal: this.signal }
      );

      // Collect text and tool_use blocks
      const textBlocks = response.content.filter(
        (b): b is Anthropic.TextBlock => b.type === "text"
      );
      const toolUseBlocks = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
      );

      // Append assistant turn to history (stateless server pattern)
      this.history.push({ role: "assistant", content: response.content });

      if (textBlocks.length > 0) {
        finalResponse = textBlocks.map((b) => b.text).join("\n");
      }

      // Handle non-terminal stop reasons explicitly
      if (response.stop_reason === "max_tokens") {
        return {
          response: finalResponse || "(response truncated by max_tokens)",
          toolsUsed,
          done: false,
        };
      }

      // tool_use: keep looping (handled below)
      // end_turn with no tool blocks: done
      // Any other unexpected stop reason: treat as done but surface response
      if (toolUseBlocks.length === 0) {
        break;
      }

      // Execute each tool call and collect results
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of toolUseBlocks) {
        // Check abort before each tool so we stop mid-batch on cancellation
        if (this.signal?.aborted) {
          return {
            response: finalResponse || "(agent cancelled during tool execution)",
            toolsUsed,
            done: false,
          };
        }

        toolsUsed.push(block.name);

        const tool = this.tools.find((t) => t.name === block.name);
        let content: string;
        let isError = false;

        if (!tool) {
          content = `Unknown tool: "${block.name}"`;
          isError = true;
        } else {
          try {
            content = await tool.run(block.input as Record<string, unknown>);
            // Tools return error strings prefixed with "Error:"
            if (content.startsWith("Error")) isError = true;
          } catch (err) {
            content = `Tool "${block.name}" threw: ${(err as Error).message}`;
            isError = true;
          }
        }

        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content,
          is_error: isError,
        });
      }

      // Feed tool results back as a user message (stateless server pattern)
      this.history.push({ role: "user", content: toolResults });
    }

    if (turns >= this.maxTurns) {
      return {
        response: finalResponse || "(agent stopped: max turns reached)",
        toolsUsed,
        done: false,
      };
    }

    return { response: finalResponse, toolsUsed, done: true };
  }
}
