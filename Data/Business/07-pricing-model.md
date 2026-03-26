# ORDR-Connect — Pricing Model

> **Document Classification:** Confidential — Internal Strategy
> **Version:** 1.0
> **Last Updated:** 2026-03-24
> **Owner:** Synexiun Commercial Strategy

---

## 1. Pricing Philosophy

ORDR-Connect pricing is governed by three principles:

1. **Cost aligns with value delivered.** Customers pay more only when they extract more value. A collections agency recovering $2M/month should pay more than a 3-person support team — and should be happy to.
2. **No shelf-ware.** Every dollar spent maps to measurable activity (conversations resolved, agents deployed, compliance audits passed). If a customer stops getting value, their bill drops — and that is a product problem, not a pricing success.
3. **Security is included, never upsold.** SOC 2, ISO 27001, HIPAA, and CCPA compliance capabilities ship in every tier. Audit logs, encryption, and access controls are not premium features. This is a non-negotiable architectural decision, not a marketing choice.

### Target Economics

| Metric | Target | Rationale |
|--------|--------|-----------|
| Net Revenue Retention (NRR) | 110–120% | Land-and-expand within accounts |
| Gross Margin | 75–82% | AI inference optimization via tiered routing |
| LTV:CAC Ratio | 4:1+ | Efficient PLG funnel reduces blended CAC |
| Payback Period | < 12 months | Fast time-to-value reduces churn risk |
| Logo Churn | < 5% annually | Compliance lock-in + integration depth |

---

## 2. Hybrid Pricing Structure

ORDR-Connect uses a three-layer pricing model that combines predictability with usage alignment.

### Layer 1 — Platform Fee (Predictable Base)

Monthly per-team subscription covering infrastructure, compliance, and core features.

| Tier | Monthly Price | Included | Target Segment |
|------|--------------|----------|----------------|
| **Starter** | $0 | 2 users, 1 agent, 1 channel, 500 interactions/mo, community support | Solo operators, evaluation |
| **Growth** | $99/mo per team | 10 users, 3 agents, 3 channels, 5,000 interactions/mo, email support | SMB teams (5–20 employees) |
| **Professional** | $199/mo per team | 25 users, 10 agents, all channels, 25,000 interactions/mo, priority support | Mid-market (20–200 employees) |
| **Enterprise** | $299/mo per team (base) | Unlimited users, unlimited agents, all channels, custom interaction volume, dedicated CSM, SLA | Enterprise (200+ employees) |

**Team** is defined as a distinct operational unit with its own workspace, data isolation boundary, and compliance scope. A single customer organization may operate multiple teams.

### Layer 2 — AI Agent Consumption (Usage-Based)

Charges per AI agent interaction beyond the tier inclusion. Pricing varies by interaction complexity.

| Interaction Type | Price | Definition |
|-----------------|-------|------------|
| **Routing / Triage** | $0.50 | Agent classifies and routes — no generative response |
| **Standard Response** | $1.50 | Agent generates a reply using cached/templated knowledge |
| **Complex Resolution** | $3.00 | Agent performs multi-step reasoning, tool calls, or cross-system lookups |
| **Specialist Agent** | $5.00 | Domain-specific agent (compliance review, financial analysis, medical triage) |

**Cost optimization is built into the architecture.** Tiered model routing sends 60–70% of interactions through lightweight models (Haiku-class, $0.001/1K tokens), 25–30% through mid-tier models (Sonnet-class), and only 3–5% through frontier models (Opus-class). This reduces blended AI cost per interaction by 60–80% compared to routing everything through a single frontier model.

### Layer 3 — Communication Pass-Through (Channel Costs)

ORDR-Connect passes through carrier/channel costs with a transparent margin.

| Channel | Provider Cost (Approx.) | ORDR Markup | Customer Price |
|---------|------------------------|-------------|----------------|
| SMS (US domestic) | $0.0075/segment | 35% | $0.01/segment |
| SMS (International) | $0.02–0.15/segment | 30% | $0.026–0.195/segment |
| Voice (US domestic) | $0.0085/minute | 35% | $0.0115/minute |
| WhatsApp Business | $0.005–0.08/message | 25% | $0.006–0.10/message |
| Email (transactional) | $0.0002/email | 40% | $0.0003/email |
| Email (bulk) | $0.0001/email | 40% | $0.00014/email |

Margin on pass-through covers: message delivery infrastructure, compliance logging (every message is Merkle-audited), retry logic, and channel failover.

---

## 3. Competitive Pricing Comparison

### Direct Competitors

| Platform | Pricing Model | Effective Cost/Interaction | What You Get | What You Don't |
|----------|--------------|---------------------------|--------------|----------------|
| **Salesforce Service Cloud + Agentforce** | $2.00/conversation | $2.00 | CRM integration, Einstein AI | Compliance audit trail, multi-model flexibility, transparent AI routing |
| **Intercom Fin** | $0.99/resolution | $0.99 (resolutions only) | Polished chat widget, knowledge base | Omnichannel beyond chat, compliance certifications, agent customization |
| **HubSpot Service Hub** | $15–150/seat/mo | $3–8 effective per interaction (low volume) | Marketing alignment, CRM | AI agents, compliance, voice/SMS channels |
| **Zendesk + AI** | $55–115/agent/mo + $1.00/automated resolution | $1.50–3.00 | Mature ticketing, marketplace | Modern AI architecture, compliance-first design |
| **Freshdesk + Freddy AI** | $15–95/agent/mo | $1.00–2.50 | Affordable entry, decent AI | Enterprise compliance, custom agents, deep integrations |

### ORDR-Connect Positioning

| Dimension | ORDR-Connect Advantage |
|-----------|----------------------|
| **Blended cost per interaction** | $0.80–1.50 (60–70% of interactions hit lightweight routing) |
| **Compliance** | SOC 2 + ISO 27001 + HIPAA included at every tier — competitors charge $50–200/seat premium for compliance add-ons |
| **AI flexibility** | Multi-model, customer-configurable — not locked into one vendor's AI |
| **Audit trail** | Merkle tree-anchored, cryptographically verifiable — no competitor offers this |
| **Vertical specialization** | Purpose-built agents for collections, healthcare, political — competitors offer generic chatbots |

---

## 4. Vertical-Specific Pricing

### 4.1 Collections & Debt Recovery

**Model: Success-Based Pricing**

Standard CRM pricing penalizes collections agencies — high message volume, low per-interaction value. ORDR-Connect aligns with the economics of the industry.

| Component | Pricing | Notes |
|-----------|---------|-------|
| Platform fee | $199/mo base | Covers compliance infrastructure |
| AI agent interactions | Included in success fee | No per-interaction charge |
| **Success fee** | **25–50% of recovered amount** | Tiered by account age and difficulty |
| Minimum monthly | $500/mo | Ensures infrastructure coverage |

**Success Fee Tiers:**

| Account Age | Recovery Difficulty | ORDR Fee |
|-------------|-------------------|----------|
| 0–90 days | Low | 25% of recovered |
| 91–180 days | Medium | 35% of recovered |
| 181–365 days | High | 40% of recovered |
| 365+ days | Very High | 50% of recovered |

**Why this works:** Collections agencies currently pay 30–50% commission to human collectors. An AI agent recovering at even 60% of human rates but operating 24/7 at 10x volume generates substantial net gain. The customer pays nothing if the agent recovers nothing.

### 4.2 Healthcare

**Model: Per-Provider Pricing**

Healthcare pricing must account for HIPAA compliance overhead and the patient communication sensitivity.

| Component | Pricing | Notes |
|-----------|---------|-------|
| Platform fee | $299/mo per practice | Includes BAA, HIPAA audit trail, PHI encryption |
| Per-provider add-on | $49/mo per provider | Covers provider-specific agent configuration |
| AI interactions | $2.00/interaction | Higher rate reflects PHI handling, medical triage liability |
| Appointment scheduling | $0.50/booking | Lower rate for structured, low-risk interactions |
| HIPAA compliance add-on | Included | Never an upsell — BAA signed at onboarding |

**Target practice size:** 3–50 providers. Total monthly: $450–2,800/practice.

### 4.3 Political Campaigns

**Model: Campaign-Cycle Licensing**

Political campaigns have compressed timelines, extreme volume spikes, and hard end dates. Per-seat monthly pricing makes no sense.

| Component | Pricing | Notes |
|-----------|---------|-------|
| **Campaign License** | $2,500–15,000/cycle | Covers primary or general election cycle (4–6 months) |
| Voter outreach AI | Included in license | Compliance-aware (FEC, TCPA, state regulations) |
| Volunteer coordination | Included in license | Scheduling, training, task assignment |
| Donor communication | $0.02/message | Pass-through + compliance logging |
| Surge capacity | Pre-provisioned | No overage charges during GOTV surges |

**Cycle definitions:** Primary cycle (4 months), General cycle (6 months), Off-cycle/advocacy (12 months).

**Compliance value prop:** FEC compliance violations can result in campaign-ending fines. ORDR-Connect's audit trail provides defensible records of every voter contact, opt-in/opt-out, and contribution solicitation.

### 4.4 Legal Services

**Model: Matter-Based Pricing**

| Component | Pricing | Notes |
|-----------|---------|-------|
| Platform fee | $249/mo per firm | Includes attorney-client privilege protections |
| Per-matter agent | $25/active matter | Client communication agent per case |
| Document intake AI | $3.00/document processed | Classification, extraction, routing |
| Client portal | Included | Secure messaging, document sharing |

---

## 5. Free Tier Strategy (Product-Led Growth)

The free tier is the top of the funnel — not a charity. It is engineered to create activation, demonstrate value, and generate organic expansion.

### Free Tier Specifications

| Feature | Limit | Purpose |
|---------|-------|---------|
| Users | 2 | Enough for founder + one team member |
| AI agents | 1 pre-built | Demonstrates core capability |
| Channels | 1 (web chat) | Lowest cost channel for ORDR |
| Interactions | 500/month | ~17/day, enough for low-volume validation |
| Analytics | Basic dashboard | Shows value, hints at advanced analytics |
| Compliance | Full audit trail | Not degraded — security is never a premium feature |
| Data retention | 30 days | Creates urgency to upgrade for history |
| Support | Community only | Forums, docs, knowledge base |

### Conversion Triggers

| Trigger | Expected Conversion Rate | Upgrade Path |
|---------|------------------------|--------------|
| Hitting 500 interaction limit | 15–20% | Growth tier ($99/mo) |
| Needing additional channels | 10–15% | Growth tier ($99/mo) |
| Adding 3rd+ team member | 8–12% | Growth tier ($99/mo) |
| Requesting custom agent | 5–8% | Professional tier ($199/mo) |
| Needing compliance certification letter | 20–30% | Professional or Enterprise |

### PLG Metrics Targets

| Metric | Month 3 | Month 6 | Month 12 |
|--------|---------|---------|----------|
| Free sign-ups | 500 | 2,000 | 8,000 |
| Free → Paid conversion | 5% | 8% | 12% |
| Time to first value | < 10 min | < 7 min | < 5 min |
| Activation rate (sends first AI message) | 40% | 55% | 70% |

---

## 6. Enterprise Custom Pricing

Enterprise deals ($50K+ ACV) are negotiated individually but follow guardrails.

### Enterprise Pricing Guardrails

| Parameter | Floor | Ceiling | Notes |
|-----------|-------|---------|-------|
| Platform discount | 0% | 25% | Never exceed 25% off list |
| Volume interaction discount | 0% | 40% | Only for committed annual volume |
| Implementation fee | $10,000 | $150,000 | Based on integration complexity |
| Annual commitment minimum | $36,000 | — | 12-month minimum |
| SLA: uptime | 99.9% | 99.99% | 99.99% requires dedicated infrastructure |
| SLA: response time (P0) | 15 min | 5 min | Dedicated on-call for 5-min SLA |
| Custom agent development | $5,000/agent | $50,000/agent | Depends on domain complexity |
| Dedicated infrastructure | $2,000/mo surcharge | — | Single-tenant deployment option |

### Enterprise Value Justification

For a mid-market company handling 50,000 customer interactions/month:

| Scenario | Monthly Cost | Annual Cost |
|----------|-------------|-------------|
| Current state (10 agents at $55K/yr avg) | $45,833 | $550,000 |
| ORDR-Connect Professional + usage | $8,200 | $98,400 |
| **Savings** | **$37,633/mo** | **$451,600/yr** |
| Savings percentage | 82% | 82% |

Even at 50% AI resolution rate (25,000 AI + 25,000 human), the customer reduces headcount by 5 agents while improving 24/7 coverage.

---

## 7. Unit Economics Analysis

### Per-Customer Economics (Growth Tier)

| Metric | Value | Calculation |
|--------|-------|-------------|
| Monthly platform revenue | $99 | Base subscription |
| Monthly usage revenue | $150 | ~3,000 interactions × $0.05 avg overage |
| Monthly channel revenue | $25 | Communication pass-through margin |
| **Total monthly revenue** | **$274** | |
| Infrastructure cost | $18 | Compute, storage, bandwidth |
| AI inference cost | $35 | Tiered routing (70% Haiku, 25% Sonnet, 5% Opus) |
| Channel pass-through cost | $19 | Carrier costs |
| Support cost | $15 | Amortized across customer base |
| **Total monthly cost** | **$87** | |
| **Monthly gross margin** | **$187 (68%)** | |
| **Annual gross margin** | **$2,244** | |
| CAC (blended) | $800 | PLG + content + inside sales blend |
| **LTV (3-year, 95% retention)** | **$6,393** | |
| **LTV:CAC** | **8.0:1** | |
| **Payback period** | **4.3 months** | |

### Per-Customer Economics (Enterprise)

| Metric | Value |
|--------|-------|
| Average ACV | $85,000 |
| Gross margin | 78% |
| CAC (enterprise) | $25,000 |
| LTV (5-year, 97% retention) | $332,000 |
| LTV:CAC | 13.3:1 |
| Payback period | 4.5 months |

---

## 8. Negative Net Revenue Churn Mechanics

Achieving 110–120% NRR requires systematic expansion revenue exceeding contraction and logo churn.

### Expansion Levers

| Lever | Mechanism | Expected Contribution to NRR |
|-------|-----------|------------------------------|
| Seat growth | Teams grow, add users | +3–5% |
| Channel expansion | Add SMS, voice, WhatsApp to existing chat | +4–6% |
| Agent proliferation | Deploy agents for new use cases (sales, onboarding, collections) | +5–8% |
| Vertical agent upsell | Specialized agents (compliance reviewer, medical triage) | +3–5% |
| Volume growth | Customer's business grows, interactions scale | +2–4% |

### Contraction Defenses

| Defense | Mechanism |
|---------|-----------|
| Compliance lock-in | Switching means re-certifying audit trails — 3–6 month project |
| Integration depth | Deep CRM/EHR/AMS integrations create switching cost |
| Agent training data | Months of fine-tuning and feedback loops are not portable |
| Workflow embedding | Business processes built on ORDR agents become load-bearing |

---

## 9. Pricing Governance

### Price Change Policy

- **Existing customers:** 90-day written notice for any price increase. Annual increases capped at 7% unless scope changes.
- **New customers:** Pricing reviewed quarterly. Changes effective for new contracts only.
- **Enterprise contracts:** Price locked for contract term. Renewal pricing negotiated 90 days before expiry.

### Discounting Authority

| Discount Level | Approval Required |
|---------------|-------------------|
| 0–10% | Account executive |
| 11–20% | Sales director |
| 21–25% | VP of Sales + CFO |
| > 25% | CEO (exceptional circumstances only) |

### Compliance Pricing Rule

**No feature of ORDR-Connect related to security, compliance, audit logging, encryption, or access control may ever be gated behind a paid tier or add-on.** This is an architectural and ethical commitment documented in the compliance development rules. Violating this rule requires board-level override.

---

*This pricing model will be reviewed quarterly and adjusted based on market feedback, unit economics actuals, and competitive dynamics. All changes follow the pricing governance process above.*
