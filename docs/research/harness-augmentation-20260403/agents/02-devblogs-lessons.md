# Developer Lessons: Agent Harnesses and Agent Platforms

Scope: concrete developer blogs, engineering writeups, and platform docs that explain *what failed*, *what was added to the harness/platform*, and *what the takeaway is for a new agentic system*.

## High-signal sources reviewed

- [OpenAI — Harness engineering: leveraging Codex in an agent-first world](https://openai.com/index/harness-engineering/)
- [Anthropic — Our framework for developing safe and trustworthy agents](https://www.anthropic.com/news/our-framework-for-developing-safe-and-trustworthy-agents)
- [Anthropic — Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)
- [LangChain — LangGraph Platform GA](https://blog.langchain.com/langgraph-platform-ga/)
- [LangChain — Podium case study: optimize agent behavior and reduce engineering intervention by 90%](https://blog.langchain.com/customers-podium/)
- [OpenHands — Agent Skills & Context](https://docs.openhands.dev/sdk/guides/skill)
- [OpenHands — Send Message While Running](https://docs.openhands.dev/sdk/guides/convo-send-message-while-running)
- [OpenHands — Configuration Options / sandbox settings](https://docs.openhands.dev/openhands/usage/advanced/configuration-options)
- [Azure AI Foundry — Developer Essentials for Agents and Apps](https://devblogs.microsoft.com/foundry/announcing-developer-essentials-for-agents-and-apps-in-azure-ai-foundry/)
- [OpenAI — A business leaders guide to working with agents](https://cdn.openai.com/business-guides-and-resources/a-business-leaders-guide-to-working-with-agents.pdf)

## What the sources repeatedly say

1. **Agent systems fail when the environment is underspecified.**
   The recurring fix is not “try harder”; it is to add the missing scaffolding: better tool surfaces, clearer repo-local knowledge, stricter boundaries, and more legible state.

2. **Long-running work needs durable state and checkpoints.**
   Short prompt loops break down once tasks span many tool calls, human approvals, or asynchronous events. Platforms respond by adding persistence, rewind/retry, and state inspection.

3. **Human oversight is not optional for high-stakes or destructive actions.**
   Mature harnesses default to read-only or approval-gated behavior for writes, system changes, or external side effects.

4. **Visibility beats hope.**
   Logs, metrics, traces, and explicit progress artifacts are what make agent behavior debuggable. Without them, failures become opaque and expensive.

5. **Evaluation must be part of the harness, not an afterthought.**
   Evals, trace grading, offline datasets, and regression suites are what keep agent improvements from becoming regression churn.

6. **Progressive disclosure scales better than giant prompts.**
   The better pattern is a small, stable entry point plus on-demand deeper docs/skills, rather than one giant instruction blob.

## Source-by-source lessons

| Source | Failure / problem observed | Harness or platform addition | Why it matters |
|---|---|---|---|
| [OpenAI — Harness engineering](https://openai.com/index/harness-engineering/) | Early Codex progress was slow because the environment was underspecified; a single giant `AGENTS.md` failed, and human QA became the bottleneck. | Worktree-per-task, Chrome DevTools Protocol, local observability stack, short `AGENTS.md` as a map, docs as system of record, linting for docs freshness, repo-embedded plans. | The lesson is to move context into the repo and make the runtime legible to the agent, not to overload the prompt. |
| [Anthropic — Safe and trustworthy agents](https://www.anthropic.com/news/our-framework-for-developing-safe-and-trustworthy-agents) | Autonomous agents can take reasonable-seeming but unwanted actions, leak private info across tasks, or be tricked by prompt injection. | Read-only by default, human approval for modifying actions, real-time to-do visibility, explicit control over connectors/tool access, privacy segmentation. | A harness needs explicit control points before the agent crosses a trust boundary. |
| [Anthropic — Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents) | Multi-turn agents make mistakes that compound across tool calls, which makes evaluation much harder than single-turn prompting. | Multi-turn evals, tasks/trials/graders structure, unit-test-backed grading for tool-using systems. | If you do not encode evals, you cannot tell whether a new agent change helped or silently regressed. |
| [LangChain — LangGraph Platform GA](https://blog.langchain.com/langgraph-platform-ga/) | Agents are long-running, async, and bursty; they fail mid-task and need to wait on humans or other agents. | Persistence layer, checkpointing, rewind/edit/rerun, Studio for debugging, remote graphs, registry/workspaces/RBAC. | The platform has to survive interruptions and still resume exactly where the agent left off. |
| [LangChain — Podium case study](https://blog.langchain.com/customers-podium/) | Before traces/evals, understanding 20–30 LLM calls per interaction was hard; engineering intervention stayed high. | Dataset curation, offline evals, user feedback loops, online evaluation, prompt/retrieval/fine-tune iteration. | Strong traces plus curated datasets turn agent behavior into something you can improve systematically. |
| [OpenHands — Agent Skills & Context](https://docs.openhands.dev/sdk/guides/skill) | Big always-on prompts are brittle; the agent needs the right context at the right time. | Always-loaded repo rules, keyword-triggered skills, progressive disclosure via `SKILL.md`, installed skill lifecycle. | This is a concrete pattern for keeping the harness small while still exposing rich capabilities. |
| [OpenHands — Send Message While Running](https://docs.openhands.dev/sdk/guides/convo-send-message-while-running) | Agents sometimes need correction mid-run rather than after a full failure/retry cycle. | Mid-execution messaging to interrupt or redirect a running agent. | A good harness lets humans steer without killing the whole run. |
| [OpenHands — Configuration Options](https://docs.openhands.dev/openhands/usage/advanced/configuration-options) | Sandbox/runtime configuration is part of the product surface, not just deployment detail. | Explicit runtime modes and sandbox settings, plus persistence configuration. | Agent behavior depends on the execution substrate; runtime choices should be visible and configurable. |
| [Azure AI Foundry — Developer Essentials](https://devblogs.microsoft.com/foundry/announcing-developer-essentials-for-agents-and-apps-in-azure-ai-foundry/) | Teams waste time guessing at orchestration, monitoring, and model choice. | One portal/SDK/endpoint, integrated observability, governance, cost controls, MCP/A2A integration, model routing. | Platform friction gets pushed down when the developer surface unifies tools, tracing, and governance. |
| [OpenAI — Business leaders guide to working with agents](https://cdn.openai.com/business-guides-and-resources/a-business-leaders-guide-to-working-with-agents.pdf) | The hard part is deciding what job the agent owns and where human oversight belongs. | Task scoping, safety/supervision framing, production rollout guidance. | Clear task boundaries are a design requirement, not just a project-management preference. |

## Synthesis for harness augmentation

### Extend-current-ssenrah signals
These are additions that look compatible with the current Ssenrah direction:

- **Keep AGENTS.md short and point to deeper docs.** The OpenAI/Codex writeup is the clearest warning against a giant monolithic instruction file.
- **Add per-task worktree discipline.** OpenAI’s worktree-per-task pattern is a strong fit for isolated agent runs and parallel edits.
- **Make state inspectable.** Checkpoints, traces, short progress artifacts, and repo-local docs all reduce guesswork.
- **Add explicit approval gates for writes and external side effects.** This is a direct fit for destructive operations, approvals, and human-in-the-loop escalation.
- **Build evals into the loop.** Regression datasets, trace grading, and offline checks are necessary before broader autonomy.
- **Use progressive disclosure for knowledge.** Skills/docs should be discoverable on demand instead of dumped into the base prompt.

### Needs-new-subsystem signals
These are additions that likely need a new subsystem, not just a repo tweak:

- **Durable long-running execution with resume/retry across interruptions.**
- **A first-class observability stack tied to each task/run.**
- **Structured human approval workflows for tool-use and system changes.**
- **Centralized eval orchestration with dataset curation and trace grading.**
- **A runtime that can interrupt and re-steer live agents without restarting them.**

## Practical takeaways for Ssenrah

1. **Treat docs as a map, not the encyclopedia.**
   Keep the top-level prompt small and make the deeper source of truth navigable.

2. **Make each run resumable.**
   If an agent can be interrupted, it should also be able to resume from a checkpoint with minimal loss.

3. **Separate “can act” from “may act.”**
   Tools should exist behind approval and trust boundaries, especially for writes and external calls.

4. **Instrument everything you expect the agent to reason about.**
   Logs, metrics, traces, and progress notes need to be first-class inputs.

5. **Measure the harness, not just the model.**
   Most production gains in these sources came from better scaffolding, not from prompt iteration alone.

## Version / naming notes

- **LangGraph Platform** was later renamed to **LangSmith Deployment** in the LangChain blog note, so older articles may use the former name.
- **OpenHands** docs use both current and legacy runtime terminology; the current docs still mention `RUNTIME=process` as the legacy `RUNTIME=local` alias.
- The OpenAI and Anthropic pages cited here are current web docs/blog posts, not frozen historical snapshots, so wording and product names may evolve.
