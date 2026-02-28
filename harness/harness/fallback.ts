import { LLMProvider, ToolCall } from "../providers/types";
import { IntentDeclaration } from "./intent";

export interface FallbackConfig {
  provider: LLMProvider;
  model: string;
  maxRetries: number;
}

export interface FallbackResult {
  resolved: boolean;
  result?: string;
  attempts: number;
  summary: string;
}

interface AttemptRecord {
  attempt: number;
  toolName: string;
  input: Record<string, unknown>;
  error?: string;
  result?: string;
}

export class FallbackAgent {
  private config: FallbackConfig;

  constructor(config: FallbackConfig) {
    if (!config.provider) throw new Error("FallbackAgent requires a provider");
    if (!config.model || config.model.trim() === "") {
      throw new Error("FallbackAgent requires a model");
    }
    this.config = {
      provider: config.provider,
      model: config.model,
      maxRetries: config.maxRetries ?? 3,
    };
  }

  async handleFailure(
    failedCall: ToolCall,
    error: string,
    intent: IntentDeclaration,
    availableTools: {
      name: string;
      description: string;
      run: (input: Record<string, unknown>) => Promise<string> | string;
    }[]
  ): Promise<FallbackResult> {
    const toolMap = new Map(availableTools.map((t) => [t.name, t]));
    const attempts: AttemptRecord[] = [];
    let currentToolName = failedCall.name;
    let currentInput = { ...failedCall.input };
    let currentError = error;

    for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
      // Ask the LLM for an alternative approach
      const toolDescriptions = availableTools
        .map((t) => `- ${t.name}: ${t.description}`)
        .join("\n");

      const prompt = `A tool call failed and we need an alternative approach.

Intent: ${intent.purpose}
Expected outcome: ${intent.expectedOutcome}
Risk level: ${intent.riskLevel}

Failed tool: ${currentToolName}
Failed input: ${JSON.stringify(currentInput, null, 2)}
Error: ${currentError}

${
  attempts.length > 0
    ? `Previous attempts:\n${attempts
        .map(
          (a) =>
            `  Attempt ${a.attempt}: tool=${a.toolName}, input=${JSON.stringify(a.input)}, ${
              a.error ? `error=${a.error}` : `result=${a.result}`
            }`
        )
        .join("\n")}\n`
    : ""
}Available tools:
${toolDescriptions}

Suggest an alternative tool call to achieve the intent. Respond with ONLY a JSON object:
{"toolName": "<tool_name>", "input": {<tool_input_fields>}}

If no alternative is possible, respond with: {"toolName": null, "input": {}}`;

      let suggestion: { toolName: string | null; input: Record<string, unknown> } | null = null;

      try {
        const response = await this.config.provider.chat({
          model: this.config.model,
          messages: [{ role: "user", content: prompt }],
          maxTokens: 400,
        });
        const text = response.textBlocks.join("").trim();
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          suggestion = JSON.parse(jsonMatch[0]) as {
            toolName: string | null;
            input: Record<string, unknown>;
          };
        }
      } catch {
        attempts.push({ attempt, toolName: currentToolName, input: currentInput, error: "LLM suggestion failed" });
        continue;
      }

      if (!suggestion || suggestion.toolName === null) {
        attempts.push({ attempt, toolName: currentToolName, input: currentInput, error: "No alternative suggested" });
        break;
      }

      const tool = toolMap.get(suggestion.toolName);
      if (!tool) {
        const rec: AttemptRecord = {
          attempt,
          toolName: suggestion.toolName,
          input: suggestion.input,
          error: `Tool "${suggestion.toolName}" not found`,
        };
        attempts.push(rec);
        currentError = rec.error!;
        currentToolName = suggestion.toolName;
        currentInput = suggestion.input;
        continue;
      }

      try {
        const result = await tool.run(suggestion.input);
        attempts.push({ attempt, toolName: suggestion.toolName, input: suggestion.input, result });
        const summary = this.buildSummary(failedCall, error, attempts, true);
        return { resolved: true, result, attempts: attempt, summary };
      } catch (runErr) {
        const errMsg = runErr instanceof Error ? runErr.message : String(runErr);
        attempts.push({ attempt, toolName: suggestion.toolName, input: suggestion.input, error: errMsg });
        currentError = errMsg;
        currentToolName = suggestion.toolName;
        currentInput = suggestion.input;
      }
    }

    const summary = this.buildSummary(failedCall, error, attempts, false);
    return { resolved: false, attempts: attempts.length, summary };
  }

  private buildSummary(
    original: ToolCall,
    originalError: string,
    attempts: AttemptRecord[],
    resolved: boolean
  ): string {
    const lines: string[] = [
      `Original call: ${original.name}(${JSON.stringify(original.input)}) failed with: ${originalError}`,
      `Retry attempts: ${attempts.length}`,
    ];
    for (const a of attempts) {
      if (a.error) {
        lines.push(`  Attempt ${a.attempt}: ${a.toolName} -> ERROR: ${a.error}`);
      } else {
        lines.push(`  Attempt ${a.attempt}: ${a.toolName} -> OK`);
      }
    }
    lines.push(resolved ? "Resolution: SUCCESS" : "Resolution: FAILED — all retries exhausted");
    return lines.join("\n");
  }
}
