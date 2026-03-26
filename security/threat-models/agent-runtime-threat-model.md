# Agent Runtime Threat Model — STRIDE Analysis

**System:** ORDR-Connect Agent Runtime (apps/agent-runtime)
**Scope:** AI agent execution, tool invocation, LLM interactions
**Review date:** 2026-03-25
**Reviewer:** Security Architecture Team

---

## Assets

| Asset | Classification | Description |
|-------|---------------|-------------|
| Agent prompts | CONFIDENTIAL | System prompts with business logic |
| Customer context | RESTRICTED | PHI/PII loaded for agent decisions |
| Agent tool credentials | RESTRICTED | Service accounts for tool execution |
| LLM API keys | RESTRICTED | Anthropic Claude API keys |
| Agent reasoning logs | CONFIDENTIAL | Full decision chain for audit |
| Communication content | CONFIDENTIAL | Messages generated for customers |

---

## Threat: Spoofing

### S-AGT-01: Agent Identity Spoofing

- **Attack:** Malicious process impersonates a legitimate agent to execute tools.
- **Mitigation:** Agent sessions have unique IDs with JWT authentication. mTLS between agent-runtime and API. Agent role encoded in session token, verified server-side.
- **Control:** SOC2 CC6.1
- **Residual risk:** LOW.

---

## Threat: Tampering

### T-AGT-01: Agent Privilege Escalation

- **Attack:** Agent modifies its own permission boundaries to access restricted tools.
- **Mitigation:** Agents cannot modify their own permissions (CLAUDE.md Rule 9, agent-permissions.rego). Tool allowlist per agent role enforced server-side. Permission changes require human admin.
- **Control:** SOC2 CC6.3
- **Residual risk:** VERY LOW. OPA policy + server-side enforcement.

### T-AGT-02: Tool Boundary Violations

- **Attack:** Agent attempts to invoke tools outside its allowlisted set.
- **Mitigation:** Explicit tool allowlist per agent role (agent-permissions.rego). Every tool call validated against allowlist before execution. Unauthorized attempts logged and blocked.
- **Control:** CLAUDE.md Rule 9
- **Residual risk:** LOW.

### T-AGT-03: Prompt Injection Attacks

- **Attack:** Malicious user input is crafted to override agent instructions.
- **Mitigation:** Input safety validation (ai/safety.ts) checks for injection patterns (IGNORE_INSTRUCTIONS, ROLE_HIJACK, SYSTEM_PROMPT_EXTRACTION, JAILBREAK, ENCODING_BYPASS). PII/PHI patterns detected pre-flight. Multi-agent verification for high-stakes actions.
- **Control:** CLAUDE.md Rule 9
- **Residual risk:** MEDIUM. Novel injection techniques evolve. Continuous pattern updates required.

### T-AGT-04: Budget Bypass Attempts

- **Attack:** Agent exceeds token, action, or cost limits to perform unauthorized work.
- **Mitigation:** Per-session budget enforcement (max_tokens, max_actions, max_cost_usd). Budget checked before every tool call. Session terminated when budget exceeded.
- **Control:** SOC2 CC6.6
- **Residual risk:** LOW. Server-side enforcement with no client override.

---

## Threat: Repudiation

### R-AGT-01: Unattributed Agent Actions

- **Attack:** No record of which agent took what action and why.
- **Mitigation:** Full reasoning chain logged to WORM audit trail (prompt, context, output, confidence). Each action has unique ID. Audit events include agent_id, session_id, and confidence score.
- **Control:** HIPAA §164.312(b), SOC2 CC7.2
- **Residual risk:** VERY LOW.

---

## Threat: Information Disclosure

### I-AGT-01: PHI Leakage to LLM Provider

- **Attack:** Customer PHI sent to external LLM API without proper controls.
- **Mitigation:** PII patterns (SSN, credit card, MRN, DOB) detected and flagged before LLM calls (safety.ts). PHI fields referenced by tokenized ID, not plaintext. BAA required with LLM provider.
- **Control:** HIPAA §164.502(e)
- **Residual risk:** MEDIUM. Some PHI may be contextually necessary. BAA + data processing agreement required.

### I-AGT-02: Agent Memory Poisoning

- **Attack:** Attacker injects false information into agent memory/context to influence future decisions.
- **Mitigation:** Agent context is session-scoped (no persistent memory across sessions without validation). Context loaded from verified data sources only. RAG grounding with source verification.
- **Control:** CLAUDE.md Rule 9
- **Residual risk:** MEDIUM. Requires monitoring of context quality.

### I-AGT-03: System Prompt Extraction

- **Attack:** User crafts messages to make the agent reveal its system prompt.
- **Mitigation:** SYSTEM_PROMPT_EXTRACTION pattern detection in safety.ts. Output validation checks for prompt-like content. System prompts never included in customer-facing responses.
- **Control:** ISO 27001 A.14.1.2
- **Residual risk:** LOW.

---

## Threat: Denial of Service

### D-AGT-01: Agent Resource Exhaustion

- **Attack:** Triggering an agent into an infinite reasoning loop consuming resources.
- **Mitigation:** Token limits per execution. Action count limits. Cost budget caps. Session timeout. Kill switch capability at tenant and global level.
- **Control:** SOC2 CC6.6
- **Residual risk:** LOW.

### D-AGT-02: Tool Execution Saturation

- **Attack:** Agent makes excessive external API calls (Twilio, SendGrid) consuming quotas.
- **Mitigation:** Per-agent rate limiting. Tool-specific rate limits. Budget enforcement. Human-in-the-loop for mass communications.
- **Control:** CLAUDE.md Rule 9
- **Residual risk:** LOW.

---

## Threat: Elevation of Privilege

### E-AGT-01: Agent Self-Permission Modification

- **Attack:** Agent uses tool access to modify its own permission configuration.
- **Mitigation:** Hard policy: agents cannot modify their own permissions (agent-permissions.rego). Any self-referencing permission change is blocked at the OPA policy level. All permission changes require human admin.
- **Control:** CLAUDE.md Rule 9
- **Residual risk:** VERY LOW.

### E-AGT-02: Cross-Tenant Agent Access

- **Attack:** Agent accesses data belonging to a different tenant.
- **Mitigation:** Agent tenant_id scoped from session JWT. Every data access filtered by tenant_id. RLS enforced at database level. OPA policy blocks cross-tenant tool calls.
- **Control:** SOC2 CC6.1
- **Residual risk:** VERY LOW.

### E-AGT-03: Human-in-the-Loop Bypass

- **Attack:** Agent executes financial or PHI actions without required human approval.
- **Mitigation:** Mandatory HITL for financial actions, PHI access, and mass communications (agent-permissions.rego). Actions below 0.7 confidence require human review. HITL status checked before tool execution.
- **Control:** CLAUDE.md Rule 9
- **Residual risk:** LOW.
