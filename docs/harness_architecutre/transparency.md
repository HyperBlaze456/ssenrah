Transparency for agents is not mainly about seeing the model’s “thoughts.” It is about being able to reconstruct an entire run: which agent/version acted, what context it saw, what tool it invoked, what it changed, what guardrails fired, who approved it, and whether the outcome was correct. Recent work on agent visibility frames this as **agent identifiers, real-time monitoring, and activity logging**; current agent tooling likewise emphasizes full execution traces with prompts, tool calls, handoffs, execution times, file writes, errors, and warnings. NIST’s GenAI guidance pushes in the same direction with provenance, override monitoring, third-party plugin review, and transparency reporting. ([arXiv][1])

## What you need to log

1. **Identity and configuration**
   Log the agent/workflow ID, version, model ID, system/developer prompt version or hash, tool registry version, policy/guardrail version, sandbox mode, approval policy, tenant/session ID, and effective permissions. Without this, you cannot tell whether a failure came from the model, the scaffold, the tool configuration, or the policy layer. Agent-visibility work explicitly calls out identifiers, and current OpenAI telemetry includes model, version, conversation ID, and sandbox/approval settings as default context. ([arXiv][1])

2. **Input and context provenance**
   Log not just the user prompt, but every piece of context the agent consumed: retrieved documents, URLs, file IDs, memory entries, database rows, MCP servers/connectors, timestamps, trust labels, and redaction status. NIST explicitly highlights data provenance, review of third-party inputs/plugins, and the importance of documenting access-control issues around plugins; OpenAI warns that remote MCP servers can exfiltrate anything that enters the model’s context. ([NIST 기술 문서][2])

3. **Per-step execution traces**
   For every model step, log timestamp, prompt/response IDs, key parameters, token counts, latency, retries, streaming/completion status, and errors. Current agent stacks are already moving toward this: OpenAI’s Agents SDK says agents should “keep a full trace of what happened,” and OpenAI tracing examples include prompts, tool calls, handoffs, execution times, file writes, and errors/warnings. ([OpenAI Developers][3])

4. **Decisions and handoffs**
   In multi-agent systems, log which agent delegated to which other agent, what artifacts or state were passed, what validation/gating checks were applied, and why the handoff occurred. This is crucial because multi-agent failures often come from error propagation across stages. Research on accountable multi-agent pipelines found that structured handoffs with saved records materially improved accuracy and made blame assignment possible. ([OpenAI Developers][4])

5. **Tool calls and external side effects**
   For every tool use, log the tool name, arguments, result, duration, success/failure, output snippet/reference, and any concrete side effect: files written, database mutations, emails sent, tickets created, commits pushed, browser actions taken, or API endpoints hit. OpenAI’s tracing examples explicitly include tool calls, MCP calls, file writes, and tool results, which is the right level of granularity for audit and replay. ([OpenAI Developers][4])

6. **Safety and policy events**
   Log prompt-injection detections, policy checks, classifier results, approval requests, approval decisions, blocked actions, escalation events, and whether the decision came from config, automation, or a human. OpenAI describes prompt injection as a common and dangerous attack that can lead to private-data exfiltration or misaligned actions; Anthropic’s computer-use docs add automatic prompt-injection classifiers and user-confirmation steering for risky next actions. ([OpenAI Developers][5])

7. **Human oversight and overrides**
   When a human steps in, log who approved or overrode what, when, and with what rationale. NIST specifically recommends monitoring and documenting cases where humans override the model’s decisions, then analyzing those cases; Anthropic likewise recommends human confirmation for actions with meaningful real-world consequences. ([NIST 기술 문서][2])

8. **Outcome, incident, and retention metadata**
   Log final task status, validator/eval results, user feedback, rollback/remediation steps, incident IDs, and cost/resource usage. Make the logs tamper-evident where possible, redact sensitive content by default, and set retention rules by risk. NIST recommends digital transparency/provenance methods that create a traceable history, and for **EU high-risk AI systems**, the AI Act requires systems to technically allow automatic logging over their lifetime, with providers/deployers keeping those logs for at least six months when under their control. OpenAI’s own telemetry defaults also show the privacy side: user prompts are redacted unless explicitly enabled. ([NIST 기술 문서][2])

A useful rule is: **log enough to replay the run, attribute responsibility, and bound the damage**.

One more nuance: do **not** make raw chain-of-thought your primary audit artifact. Vendor tooling treats reasoning output as optional/noisy, and some models do not emit raw reasoning at all. Structured state-transition logs, decision summaries, and action traces are much more portable and reliable. ([OpenAI Developers][6])

## What is wrong with current agent systems

1. **They often log conversations, not behavior**
   A chat transcript is not an audit trail. In real systems, failures often happen in tool invocations, hidden retrieval steps, file writes, handoffs, or policy layers. That is exactly why current agent tooling is adding full traces rather than just storing prompts and final answers. ([OpenAI Developers][3])

2. **They are still vulnerable to prompt injection**
   This is probably the biggest transparency-plus-security problem today. Untrusted text from webpages, documents, screenshots, search results, or MCP servers can steer the agent away from developer intent or exfiltrate data. OpenAI explicitly warns about downstream exfiltration via tool calls; Anthropic warns that on-screen or webpage content may override instructions; and both older and very recent primary-source benchmarks show that tool-using agents remain vulnerable. ([OpenAI Developers][5])

3. **Long-horizon reliability is still weak**
   Agents look impressive on short tasks, but performance still degrades on longer, messier workflows. A recent primary-source time-horizon paper estimated that a frontier model’s 50% success point on software tasks was around **50 minutes of human task time**, while a separate 2026 reliability paper found only small improvements in reliability even when capability scores rose. That means “more capable” does not automatically mean “production-reliable.” ([arXiv][7])

4. **Reproducibility is fragile**
   The same prompt can produce materially different outcomes across runs or environments. Recent work on LLM nondeterminism shows that even greedy decoding can vary with GPU count, batch size, GPU version, and numerical precision; the reliability paper argues that consistency must be measured separately from raw success rate. For agents, this is worse because nondeterminism compounds over multiple steps and tools. ([arXiv][8])

5. **Multi-agent systems blur accountability**
   Once you split work across planner/executor/critic or manager/specialist agents, responsibility becomes murky. Errors can originate early, silently cascade, and only become visible in the final output. Research on accountable multi-agent pipelines found that unstructured pipelines degrade performance, while structured handoffs improve traceability and stability. ([arXiv][9])

6. **Permissioning is often too coarse for the risk**
   Desktop-control agents, browser agents, and connector/MCP agents frequently cross strong trust boundaries. Anthropic distinguishes between sandboxed tools and actual-desktop control, with explicit per-app permission tiers; OpenAI warns that remote MCP servers must be trusted because they can exfiltrate sensitive context. Many current systems still treat tool access as a binary “enabled/disabled” switch instead of a fine-grained risk surface. ([Claude API Docs][10])

7. **Evaluation is too shallow**
   A lot of agent evaluation still reduces performance to a single success metric. Recent reliability work argues that this hides critical dimensions: consistency, robustness, predictability, and safety. In practice, teams need to know not just whether an agent *can* succeed, but how often it fails, how badly it fails, and whether those failures are detectable before they cause side effects. ([arXiv][11])

8. **Privacy and observability are in tension**
   Good logs make agents debuggable, but they also risk collecting secrets, personal data, and sensitive intermediate context. That means current systems need better redaction, field-level access control, selective retention, and “reference not payload” logging. The fact that OpenAI’s OTel logging leaves user-prompt logging off by default is a strong signal that this tradeoff is real. ([OpenAI Developers][6])

The practical standard I’d use is this:

**After any bad run, you should be able to answer six questions in minutes, not days:**
who acted, under which version/config, on what context, with what permissions, what external effects occurred, and what safety/human checks ran before and after.

That is the difference between an impressive demo and a governable agent system.

A next step could be to turn this into a concrete event schema for agent logging, such as an OpenTelemetry-style trace model with required fields per event.

[1]: https://arxiv.org/pdf/2401.13138 "Visibility into AI Agents"
[2]: https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf "Artificial Intelligence Risk Management Framework: Generative Artificial Intelligence Profile"
[3]: https://developers.openai.com/api/docs/guides/agents-sdk/ "Agents SDK | OpenAI API"
[4]: https://developers.openai.com/cookbook/examples/codex/codex_mcp_agents_sdk/building_consistent_workflows_codex_cli_agents_sdk/ "Building Consistent Workflows with Codex CLI & Agents SDK"
[5]: https://developers.openai.com/api/docs/guides/agent-builder-safety/ "Safety in building agents | OpenAI API"
[6]: https://developers.openai.com/codex/config-advanced/ "Advanced Configuration – Codex | OpenAI Developers"
[7]: https://arxiv.org/abs/2503.14499 "[2503.14499] Measuring AI Ability to Complete Long Software Tasks"
[8]: https://arxiv.org/pdf/2506.09501 "Understanding and Mitigating Numerical Sources of Nondeterminism in LLM Inference"
[9]: https://arxiv.org/html/2510.07614v1 "Traceability and Accountability in Role-Specialized Multi-Agent LLM Pipelines"
[10]: https://docs.anthropic.com/en/docs/claude-code/desktop "Use Claude Code Desktop - Claude Code Docs"
[11]: https://arxiv.org/abs/2602.16666 "[2602.16666] Towards a Science of AI Agent Reliability"
