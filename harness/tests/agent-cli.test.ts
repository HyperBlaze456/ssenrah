import {
  buildTeamRunConfig,
  classifyTeamRunError,
  detectTeamNlTrigger,
  parseArgs,
  parseTeamSlashCommand,
  resolveTeamRouteDecision,
  runTeamRouteWithFallback,
} from "../agent-cli";
import { EventLogger } from "../harness/events";
import { ChatResponse, LLMProvider, ProviderConfig } from "../providers/types";

function createMockProvider(label: string): LLMProvider {
  const response: ChatResponse = {
    textBlocks: ["ok"],
    toolCalls: [],
    stopReason: "end_turn",
  };
  return {
    name: label,
    chat: jest.fn(async () => response),
  };
}

describe("agent-cli team mode", () => {
  it("parses team CLI flags into options", () => {
    const parsed = parseArgs([
      "--team",
      "--allow-team-fallback",
      "--provider",
      "openai",
      "--model",
      "gpt-4o-mini",
      "--goal",
      "ship fixes",
      "--max-workers",
      "4",
      "--worker-model",
      "gpt-4.1",
      "--orchestrator-model",
      "gpt-4o-mini",
      "--verify-before-complete",
      "--mcp",
      "--mcp-config",
      "./.ssenrah/mcp.servers.json",
      "--verbose",
    ]);

    expect(parsed.teamMode).toBe(true);
    expect(parsed.allowTeamFallback).toBe(true);
    expect(parsed.providerType).toBe("openai");
    expect(parsed.model).toBe("gpt-4o-mini");
    expect(parsed.goal).toBe("ship fixes");
    expect(parsed.maxWorkers).toBe(4);
    expect(parsed.workerModel).toBe("gpt-4.1");
    expect(parsed.orchestratorModel).toBe("gpt-4o-mini");
    expect(parsed.verifyBeforeComplete).toBe(true);
    expect(parsed.mcpEnabled).toBe(true);
    expect(parsed.mcpConfigPath).toBe("./.ssenrah/mcp.servers.json");
    expect(parsed.verbose).toBe(true);
  });

  it("defaults allow-team-fallback to false", () => {
    const parsed = parseArgs(["--team", "--goal", "ship fixes"]);
    expect(parsed.allowTeamFallback).toBe(false);
  });

  it("plumbs parsed team args into TeamConfig", () => {
    const parsed = parseArgs([
      "--team",
      "--provider",
      "anthropic",
      "--goal",
      "implement cli updates",
      "--max-workers",
      "2",
      "--worker-model",
      "claude-sonnet-4-20250514",
      "--orchestrator-model",
      "claude-3-5-haiku-20241022",
      "--verify-before-complete",
      "--mcp",
      "--verbose",
    ]);

    const factoryCalls: ProviderConfig[] = [];
    const providerFactory = jest.fn((config: ProviderConfig) => {
      factoryCalls.push(config);
      return createMockProvider(`${config.type}:${config.model}`);
    });

    const result = buildTeamRunConfig(parsed, providerFactory);

    expect(result.goal).toBe("implement cli updates");
    expect(result.teamConfig.name).toBe("cli-team");
    expect(result.teamConfig.maxWorkers).toBe(2);
    expect(result.teamConfig.workerModel).toBe("claude-sonnet-4-20250514");
    expect(result.teamConfig.orchestratorModel).toBe("claude-3-5-haiku-20241022");
    expect(result.teamConfig.verifyBeforeComplete).toBe(true);
    expect(result.teamConfig.mcpEnabled).toBe(true);
    expect(result.teamConfig.verbose).toBe(true);
    expect(result.teamConfig.allowFallback).toBe(false);
    expect(result.teamConfig.triggerSource).toBe("flag");
    expect(factoryCalls).toEqual([
      { type: "anthropic", model: "claude-3-5-haiku-20241022" },
      { type: "anthropic", model: "claude-sonnet-4-20250514" },
    ]);
  });

  it("requires --goal in team mode", () => {
    const parsed = parseArgs(["--team"]);
    expect(() => buildTeamRunConfig(parsed)).toThrow(
      "Team mode requires --goal <text>."
    );
  });

  it("parses /team slash command with overrides and fallback flag", () => {
    const parsed = parseTeamSlashCommand(
      "/team --allow-team-fallback --max-workers 3 --worker-model gpt-4.1 --orchestrator-model gpt-4o-mini ship release"
    );
    expect(parsed).toEqual({
      command: "team",
      goal: "ship release",
      allowFallback: true,
      overrides: {
        maxWorkers: 3,
        workerModel: "gpt-4.1",
        orchestratorModel: "gpt-4o-mini",
      },
    });
  });

  it("rejects /team without goal", () => {
    expect(parseTeamSlashCommand("/team --max-workers 2")).toBeNull();
  });

  it("detects deterministic natural-language team triggers and avoids false positives", () => {
    expect(detectTeamNlTrigger("run team mode to fix lint").matched).toBe(true);
    expect(detectTeamNlTrigger("team: update tests").matched).toBe(true);
    expect(detectTeamNlTrigger("I like teamwork and team spirit").matched).toBe(
      false
    );
  });

  it("routes slash and NL input through deterministic route decisions", () => {
    const slash = resolveTeamRouteDecision({
      rawInput: "/team --allow-team-fallback ship release",
    });
    expect(slash.route).toBe("team");
    expect(slash.triggerSource).toBe("slash");
    expect(slash.allowFallback).toBe(true);

    const nl = resolveTeamRouteDecision({
      rawInput: "run team to fix runtime",
    });
    expect(nl.route).toBe("team");
    expect(nl.triggerSource).toBe("nl_trigger");
    expect(nl.allowFallback).toBe(false);
  });

  it("classifies transient and non-transient team errors", () => {
    expect(classifyTeamRunError(new Error("429 rate limit exceeded"))).toBe(
      "rate_limited"
    );
    expect(classifyTeamRunError(new Error("socket hang up"))).toBe(
      "transport_reset"
    );
    expect(classifyTeamRunError(new Error("syntax error in planner"))).toBe(
      "non_transient"
    );
  });

  it("uses fallback for transient failures when opt-in is enabled", async () => {
    const decision = resolveTeamRouteDecision({
      rawInput: "run team to fix runtime",
    });
    const logger = new EventLogger();
    const runSingleAgentGoal = jest.fn(async () => undefined);

    await runTeamRouteWithFallback({
      decision: { ...decision, allowFallback: true, fallbackPolicy: "transient_only" },
      interactive: false,
      runTeam: async () => {
        throw new Error("429 rate limit");
      },
      runSingleAgentGoal,
      fallbackLogger: logger,
    });

    expect(runSingleAgentGoal).toHaveBeenCalledTimes(1);
    const events = logger.getEvents();
    expect(events[0]?.type).toBe("team_fallback_decision");
    expect(events[1]?.type).toBe("team_fallback_outcome");
    expect(events[1]?.data["outcome"]).toBe("fallback_success");
    expect(events[1]?.data["exitCode"]).toBe(0);
  });

  it("fails closed for transient failures without opt-in", async () => {
    const logger = new EventLogger();
    const runSingleAgentGoal = jest.fn(async () => undefined);

    await expect(
      runTeamRouteWithFallback({
        decision: {
          route: "team",
          triggerSource: "flag",
          goal: "ship fixes",
          allowFallback: false,
          fallbackPolicy: "fail_closed",
          rawInput: "ship fixes",
        },
        interactive: false,
        runTeam: async () => {
          throw new Error("503 service unavailable");
        },
        runSingleAgentGoal,
        fallbackLogger: logger,
      })
    ).rejects.toThrow("503 service unavailable");

    expect(runSingleAgentGoal).not.toHaveBeenCalled();
    const outcome = logger.getEvents()[1];
    expect(outcome?.type).toBe("team_fallback_outcome");
    expect(outcome?.data["outcome"]).toBe("no_fallback");
    expect(outcome?.data["exitCode"]).toBe(1);
  });

  it("does not fallback on non-transient errors even with opt-in", async () => {
    const logger = new EventLogger();
    const runSingleAgentGoal = jest.fn(async () => undefined);

    await expect(
      runTeamRouteWithFallback({
        decision: {
          route: "team",
          triggerSource: "slash",
          goal: "ship fixes",
          allowFallback: true,
          fallbackPolicy: "transient_only",
          rawInput: "/team ship fixes",
        },
        interactive: false,
        runTeam: async () => {
          throw new Error("planner schema mismatch");
        },
        runSingleAgentGoal,
        fallbackLogger: logger,
      })
    ).rejects.toThrow("planner schema mismatch");

    expect(runSingleAgentGoal).not.toHaveBeenCalled();
    const outcome = logger.getEvents()[1];
    expect(outcome?.data["errorClass"]).toBe("non_transient");
    expect(outcome?.data["outcome"]).toBe("no_fallback");
  });

  it("keeps interactive fallback outcome exit code unset", async () => {
    const logger = new EventLogger();
    await runTeamRouteWithFallback({
      decision: {
        route: "team",
        triggerSource: "slash",
        goal: "ship fixes",
        allowFallback: true,
        fallbackPolicy: "transient_only",
        rawInput: "/team --allow-team-fallback ship fixes",
      },
      interactive: true,
      runTeam: async () => {
        throw new Error("timeout while scheduling");
      },
      runSingleAgentGoal: async () => undefined,
      fallbackLogger: logger,
    });

    const outcome = logger.getEvents()[1];
    expect(outcome?.data["outcome"]).toBe("fallback_success");
    expect(outcome?.data["exitCode"]).toBeUndefined();
  });
});
