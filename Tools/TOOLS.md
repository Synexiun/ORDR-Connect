# ORDR-Connect — Selected Tools

> 4 tools selected from 9 evaluated. Selection criteria: relevance to compliance-first Customer Operations OS, architectural fit, production readiness.

## Adopted Tools

### 1. DeerFlow — Core Agentic Runtime [VERY HIGH]

**What**: Super-agent harness built on LangGraph. Orchestrates sub-agents, manages memory, provides sandboxed execution, supports multi-channel integration (Slack, Telegram).

**Why adopted**:
- LangGraph multi-agent orchestration (matches our Agent Runtime primitive)
- Docker-sandboxed execution (SOC 2 isolation requirement)
- Markdown-based skills framework (matches compliance workflow patterns)
- Persistent long-term memory (customer context retention)
- MCP integration (our integration layer standard)
- Multi-channel IM support (extends our Execution Layer)

**Integration plan**:
- Phase 1: Study orchestration patterns, adopt LangGraph workflow design
- Phase 2: Build ORDR agent skills on top of DeerFlow's skill framework
- Phase 3: Integrate sandbox execution for compliance-gated operations

**Location**: `Tools/deer-flow/`

---

### 2. Agency-Agents — Agent Persona Library [HIGH]

**What**: 80+ specialized AI agent definitions across 10 divisions. Each agent has personality, memory model, mission, critical rules, workflow, and success metrics.

**Why adopted**:
- Direct agent personas for ORDR: Legal Compliance Checker, Security Engineer, Support Responder, Data Consolidation Agent, Backend Architect
- Agentic Identity & Trust Architect pattern (maps to our Governance Layer)
- Multi-tool integration patterns (Claude Code, Cursor, GitHub Copilot)
- Real-world multi-agent coordination examples (Nexus Discovery with 8+ parallel agents)

**Agents to derive for ORDR-Connect**:
| ORDR Agent | Source Persona | Purpose |
|-----------|---------------|---------|
| Compliance Agent | Legal Compliance Checker + Security Engineer | SOC2/HIPAA/ISO27001 audit automation |
| Customer Ops Agent | Support Responder + Data Consolidation | Multi-channel customer management |
| Data Pipeline Agent | Backend Architect + Analytics Reporter | Event stream orchestration |
| Identity Agent | Agentic Identity & Trust Architect | Multi-tenant auth enforcement |
| Collections Agent | Custom (new) | FDCPA/Reg F compliant debt recovery |
| Healthcare Agent | Custom (new) | HIPAA-compliant patient engagement |

**Location**: `Tools/agency-agents/`

---

### 3. Skills — Development Process Skills [MEDIUM]

**What**: 18 modular AI skills for planning, development, and tooling. Markdown-based, designed for Claude Code integration.

**Why adopted**:
- `setup-pre-commit`: Aligns with our compliance gate (gitleaks, eslint-security)
- `git-guardrails-claude-code`: Git workflow enforcement
- `write-a-prd`: Product requirement documentation
- `tdd`: Test-driven development loops (critical for 80%+ coverage mandate)
- `improve-codebase-architecture`: Architecture review patterns
- `write-a-skill`: Template for creating new ORDR-specific skills

**Skills to create for ORDR (using write-a-skill template)**:
- `/compliance-audit` — Run compliance checks against SOC2/ISO27001/HIPAA controls
- `/threat-model` — Generate STRIDE threat model for a component
- `/schema-validate` — Validate event schemas against Schema Registry
- `/agent-safety-review` — Review agent permissions, budgets, and safety boundaries
- `/data-classification` — Classify data fields and verify encryption requirements

**Location**: `Tools/skills/`

---

### 4. Shannon — Autonomous Pentesting [MEDIUM]

**What**: AI-powered autonomous penetration testing. Multi-phase pipeline (Recon → Analysis → Exploitation → Reporting) with proof-of-concept exploit generation.

**Why adopted**:
- "No exploit, no report" policy eliminates false positives
- Source-aware dynamic testing (understands our codebase)
- OWASP Top 10 coverage (mandated by ISO 27001 A.8.26)
- Automated PoC generation for compliance evidence
- Temporal-based workflow (resumable, auditable)
- Supports Claude Agent SDK for agent orchestration

**Integration plan**:
- CI/CD gate: Every merge to `main` triggers Shannon scan on staging
- Monthly compliance: Full penetration test for SOC 2 evidence collection
- Quarterly boundary testing: Tenant isolation, RBAC enforcement validation
- Pre-integration: Security scan before adding third-party APIs

**Location**: `Tools/shannon/`

---

## Rejected Tools (with rationale)

| Tool | Reason |
|------|--------|
| **ANE** | Apple Neural Engine hardware research. No applicability to cloud SaaS. |
| **MoneyPrinterV2** | Content monetization automation. Out of scope for enterprise CRM. |
| **Autoresearch** | GPU-based ML research. Irrelevant to customer operations. |
| **Pentagi** | Overlaps with Shannon. Shannon has better fit (TypeScript, Temporal, Claude Agent SDK). |
| **MiroFish** | Swarm simulation for forecasting. Optional for Phase 4 advanced analytics. Could revisit. |
