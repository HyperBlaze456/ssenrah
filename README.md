# ssenrah
Harnesses for everyone, everything.

# Philosophy
## Agent harness
AI agent is an LLM making decisions and acting on its own for relatively long period of time.

However, due to context limitations agents fail in complex / long running tasks.

Now we have agent teams(agent can spawn multiple sub agents, which can create another subagent...)

Side effect of these failures usually leads to following:
- Best case scenario
    - Model confuses, identifies itself and checks the plan to resolve such misbehavior and re-align itself to proper tasks.
    - Or, Model stops by itself, clarifying user's intentions.
    - In team scenarios, other agents sends a 'mail' to misbehaving agent.
        - Either the orchestrator gets informed to terminate the agent
        - Or the agent fixes itself(context clearing might be done, forcing `/compact` and such)
- Moderate case scenario
    - The agent does '뻘짓'.
        - Adding unnecessary amounts of complexity to its own workflow
        - Practically does nothing, but codes are edited(nobody knows the purpose, due to agent complexity)
    - Intentions are misaligned
        - Even with TODO list mentioned, the (sub)agent fails to read while continuing long running task
            - Some requirements are not met
            - Agent works on a different feature
    - Tool calling fails
        - Persuades different method, but then forgets the purpose of this tool calling to resolve whatever task given at first
        - Does wrongful tool calling
            - Another intention ignorance problem emerges
    - Spawns in less or more amount of subagents
        - Really does nothing, adds unnecessary complexity

- Worst case scenario
    - Destructive actions
        - Drops the live database (???)
        - Codebase altered too much without clear purpose.
    - Cost-ineffective actions
        - Re-implements already near-perfect libraries
        - Endless tool calling loop.
    - Intentions mismatch
        - Usually due to failure of making & reading plans beforehand(claude.md, todo.md)
        - Both orchestrator and subagent may cause this.
        - Or another tool calling caused context pollution

---

The agent harness is a system with multiple components to make LLMs behave well. Internal loops, orchestrating structure, tool calling, prompting(system prompt, skills, slash commands)... you name it!

Harness could be more than what we think.

Anything can be considered as harness, as long as it helps the agentic workflow to perform better. 
This is my thought, but harnesses must always ensure
1. Do not fail at all
2. The fail should lead only to best case scenarios.

Without this, agencies are nothing more than just name. This is just back to assistants on steroid, not really an agent.

## Vision
### Trustable Harnesses
Ultimately, harnesses should make an workflow. But isn't making of a workflow also a workflow? Agents acting based on its own agency is a workflow too, if we think elastically.

But unlike its name 'harness', it is not static at all. Because LLMs are unpredictable, and agent's context management is very challenging.

So there should be evaluation for the harnesses.

End2End evaluation, ensurance. Harnesses should be fail safe(zero-trust, anything can be broken at any stage). Ideally, harnesses should be 99.9% unable to fail, and that 0.1% failures would immediately get notified by the user to intervene.

More strong orchestration techniques must be used. I would handle the prompt for this cleanly. Tool calling would be cleanly handled by super lightweight and cheap agents when failed initially etc.

References:

https://www.tbench.ai/registry/terminal-bench/2.0

https://runehub.ai/runes

### Building harnesses
Look, harnesses are cool and stuff.

But the current era of CLI being the main entrypoint of having and building harnesses? No, this is not ideal.

Custom harnesses must be quickly built. Model setting is the only component that makes sense in the cli. Rest of the MCP, prompt settings etc. should not be configured in the terminal.

Surely it is kind of reasonable for the agent itself to be living in the cli environment, but configuration / onboarding must not be like that. At least the comfortable of OpenClaw onboarding, ideally a separate app to configure all of them.


---

We work on [`examples/`](./examples/) for a TypeScript implementation of this better, extendable and fuse my vision.