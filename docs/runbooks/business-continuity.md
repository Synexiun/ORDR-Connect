# ORDR-Connect — Business Continuity Plan (BCP)

## Classification

| Field | Value |
|-------|-------|
| Severity | P0 — Critical |
| Compliance | ISO 27001:2022 A.5.29–A.5.30 · SOC 2 CC9.1, A1.2, A1.3 · HIPAA §164.308(a)(7)(i)(E) · GDPR Art. 32(1)(b–c) |
| Last tested | _YYYY-MM-DD_ |
| Owner | Platform Engineering + Operations |
| Reviewers | Security, Compliance, Legal, Finance |
| Activation | Any event triggering sustained disruption (> 1h) to a critical business function |

Scope note: this plan covers **business continuity** — keeping customer
operations and regulatory obligations intact during disruption. For *technical*
recovery of infrastructure see `disaster-recovery.md`; for *security* incidents
see `incident-response.md`. The three plans are complementary and may be
activated together during a major event.

---

## Business Impact Analysis (BIA)

Ranked by impact tolerance. Tolerance = how long the function can be unavailable
before customer, financial, or regulatory harm becomes material.

| Function | Criticality | Max Tolerable Outage (MTO) | Recovery Time Objective | Primary Dependencies |
|----------|-------------|----------------------------|-------------------------|----------------------|
| **PHI access controls** | CRITICAL | 0 — must never fail-open | 0 | Auth (WorkOS), RLS, audit chain |
| **Audit logging (WORM)** | CRITICAL | 0 — compliance breach if gaps | 0 | PostgreSQL + S3 Object Lock |
| **Customer API (read)** | HIGH | 1 hour | 5 min (DR failover) | Hono, RDS read replicas |
| **Customer API (write)** | HIGH | 4 hours | 15 min | RDS primary, Kafka |
| **Agent execution** | HIGH | 4 hours | 30 min | Agent-runtime, Claude API |
| **Outbound communications** | MEDIUM | 8 hours | 1 hour | Twilio, SendGrid |
| **Inbound webhooks** | MEDIUM | 8 hours | 1 hour | API Gateway, Kafka |
| **Admin console (internal)** | MEDIUM | 24 hours | 4 hours | Web app, auth |
| **Analytics / reporting** | LOW | 72 hours | 24 hours | ClickHouse, Grafana |
| **Marketing site** | LOW | 72 hours | 24 hours | Static CDN |

Any function exceeding its MTO requires executive notification (L3+) and may
trigger customer SLA credits; regulator notification may follow (see
`incident-response.md` Procedure 5).

---

## Continuity Strategies by Disruption Class

### A. Primary-region infrastructure loss

Covered by `disaster-recovery.md` Procedure 3 (full region DR). Business-side
actions during activation:

1. **Comms Lead** posts status page incident within 10 minutes of declaration.
2. **Customer Success** pre-drafts opt-in customer emails using the status-page
   template; Legal approves before send.
3. **Finance** freezes any outbound ACH/wire runs that depend on the affected
   region until recovery is verified.
4. **Sales** pauses any new-contract signature workflow until audit chain is
   verified healthy (contract execution depends on integrity guarantees).

### B. Critical SaaS vendor failure

Tenancy of each critical upstream is rated by its fail-open / fail-closed default:

| Vendor | Purpose | Fallback | Fail-closed impact |
|--------|---------|----------|--------------------|
| WorkOS | SSO + SCIM | Local JWT continues to verify existing sessions (15 min TTL) | No new logins; existing sessions work |
| HashiCorp Vault | Secret store | Kubernetes secrets copy (cached at pod start) | Secret rotation blocked; running services OK |
| AWS KMS | Field encryption keys | None — mandatory dependency | PHI writes fail closed (correct behavior) |
| Claude API (Anthropic) | Agent LLM | Queue to Kafka `agent.backlog` topic | Agent decisions delayed, not lost |
| Twilio | SMS / Voice | SendGrid email fallback for SMS notifications | SMS delayed; email path works |
| SendGrid | Transactional email | Twilio email fallback (paid add-on) | Email delayed; SMS path works |
| Neo4j Aura | Customer graph | PostgreSQL graph projection (read-only, stale up to 5 min) | Graph queries degraded, not broken |
| ClickHouse | Analytics | PostgreSQL analytics schema (smaller, slower) | Dashboards slow; reporting unaffected |
| Confluent Cloud (Kafka) | Event stream | Local disk buffer + replay on restore | Eventual consistency lag; writes buffered |

**Activation procedure on vendor failure:**

1. IC declares vendor-outage incident, references the row above.
2. Comms Lead updates status page with vendor name, expected impact, and
   fallback behavior.
3. Platform lead activates the fallback path (feature flag, config swap, or
   manual promotion).
4. Finance assesses any SLA credit obligation to customers.
5. Legal logs the vendor outage for the quarterly subprocessor report.

### C. Office / physical site unavailability

ORDR-Connect is remote-first. Physical continuity is handled by:

- No single office holds production credentials, documentation, or keys.
- Every on-call engineer has an independent tested work-from-anywhere setup.
- Paging, incident tooling, and comms work from any internet connection.
- Physical HQ loss → zero impact on production systems or customer operations.

If a major physical event (natural disaster, public-safety emergency) affects
a concentrated cluster of staff (>30% of oncall pool within a geographic region):

1. IC activates **extended oncall pool** (non-primary engineers with oncall training).
2. Vendor PagerDuty is configured to prefer engineers outside the affected region.
3. Any affected engineer's secrets / sessions are proactively rotated.
4. HR + Security confirm each affected engineer's personal safety before resuming
   their oncall rotation.

### D. Staff unavailability (key-person dependency)

No single engineer holds sole knowledge of any critical system. Enforcement:

- Every runbook is peer-reviewed and tested by at least 2 engineers quarterly.
- Every production credential requires 2-person approval (Vault + approvals).
- Every service has a primary AND secondary named owner in the service catalog.

If a key engineer becomes unavailable (illness, departure, emergency):

1. Service catalog secondary owner takes primary responsibility immediately.
2. Security rotates any personal credentials held by the unavailable engineer.
3. Within 24h, the platform lead assigns a new secondary owner.
4. Within 7 days, the promoted primary runs a tabletop of their new systems.

### E. Cyberattack — ransomware, supply-chain compromise, nation-state

Handled primarily by `incident-response.md`. BCP-specific additions:

1. **Isolation mode**: disconnect production from all non-essential external
   networks; only KMS, object storage, and customer API egress remain.
2. **Degraded write mode**: agents are paused, only audit and auth writes allowed.
3. **Offline backups**: restore from S3 Object Lock replica in a separate AWS
   account (break-glass credentials held by CTO + General Counsel).
4. **Legal hold**: all logs and artifacts from T-30 days are frozen at activation.

### F. Regulatory shutdown / forced data localization

Unlikely but covered. If a regulator orders immediate data localization or
operational cessation in a region:

1. Legal + Compliance assess the order within 4 hours.
2. If ordered: feature flag gates writes to affected jurisdiction tenants.
3. Data-residency module (`packages/core/src/types/data-residency.ts`) enforces
   region pinning from that point forward.
4. Customer success notifies affected tenants within 24 hours of flag activation.

---

## Activation & Command Chain

| Condition | Activator | Authority |
|-----------|-----------|-----------|
| Single-vendor outage, < MTO | Platform on-call | Tactical — activate fallback |
| Multi-vendor or extended outage | Platform lead | Declares BCP activation, pages L3 |
| Region / data-center loss | Incident Commander | Full BCP activation, pages CTO |
| Sustained > 24h disruption | CTO | Customer comms, regulator notification authority |
| Existential threat (cyberattack, legal) | CEO + General Counsel | External comms, law enforcement engagement |

Activation is logged in the incident tracker with a timestamped declaration and
the specific BIA rows / strategies being invoked.

---

## Communications Plan

### Internal

- **Slack `#inc-<YYYYMMDD>-<slug>`** — real-time operational coordination.
- **Slack `#leadership-alerts`** — hourly status summaries during P0/P1 events.
- **Email to `all-hands@`** — once at activation, once per 4h during sustained
  events, once at resolution. Drafted by Comms Lead, approved by IC.

### External (customers)

- **Status page** (`status.ordr-connect.io`) — primary channel. All updates
  within 30 minutes of material change.
- **Direct email** — for tenant-specific impact. Templates pre-drafted, Legal
  approval required before send.
- **In-app banner** — when customer API is degraded but reachable.

Comms must NEVER include: raw PHI, specific vulnerability details, vendor
credentials, or internal system names beyond what's public.

### External (regulators, law enforcement, insurers)

Regulator comms flow through `incident-response.md` Procedure 5. Insurance
notification (cyber policy) follows carrier requirements — typically within 72h
of confirmed material impact. Legal owns all external counsel coordination.

### External (subprocessors, vendors)

If our disruption affects how we transmit data to subprocessors (e.g., can't
deliver logs to a SIEM vendor), notify the vendor within 24h. Maintain the
notification on file for the quarterly subprocessor-report DPA requirement.

---

## Recovery & Resumption

Only resume a function after:

1. **Technical recovery verified** — per `disaster-recovery.md` checklists.
2. **Security integrity verified** — audit chain Merkle verification, no chain
   gaps in the affected period (`packages/audit/src/merkle.ts`).
3. **Data integrity verified** — spot-check critical invariants (tenant count,
   PHI row count, billing row count match last good checkpoint).
4. **Vendor-path restored** — for vendor-failure events, a live round-trip
   confirms the primary path before deactivating fallback.
5. **Customer comms updated** — status page reflects resolved state with root
   cause summary (no PHI, no vendor-secret details).

Resume in priority order (from BIA table above): PHI access → audit → customer
API read → write → agents → outbound comms → admin console → analytics.

---

## Financial Continuity

- **Payroll**: processed through an external payroll provider (Gusto) with a
  14-day forward buffer. A 7-day ORDR-Connect outage has zero payroll impact.
- **Customer invoicing**: batched monthly via Stripe. A single-week outage
  shifts the billing run but does not cause revenue loss.
- **Vendor payables**: 30–60 day terms; short-term disruption is absorbed.
- **Reserve fund**: operates with ≥ 6 months of runway at all times (CFO
  dashboard, monthly board review).

If a BCP event threatens runway or payroll, CFO notifies CEO + board within 24h
and activates the contingency financing plan (retained capital line of credit).

---

## Testing Cadence

| Exercise | Frequency | Owner | Evidence |
|----------|-----------|-------|----------|
| BIA review + update | Annually | Platform + Ops + Finance | BIA dated and version-controlled here |
| Vendor fallback drill (one vendor from class B above) | Quarterly | Platform | Fallback activation log + recovery time |
| Region DR full exercise | Annually | Platform | DR tabletop + partial failover test |
| BCP tabletop (one strategy from above) | Quarterly | IC + Ops | Tabletop log + action items |
| Comms drill (status page + email template) | Annually | Comms Lead | Dry-run log + template refresh |
| Full BCP activation rehearsal | Annually | Executive team | Rehearsal report, attached to SOC 2 evidence |

Update `Last tested` metadata at the top of this file after each exercise.

---

## Compliance Mapping

- **ISO 27001:2022 A.5.29** — Information security during disruption — Procedures B, E, recovery preconditions.
- **ISO 27001:2022 A.5.30** — ICT readiness for business continuity — BIA, continuity strategies, testing cadence.
- **SOC 2 CC9.1** — Identification, selection, and development of risk mitigation activities — vendor strategy table, isolation modes.
- **SOC 2 A1.2** — Environmental protections, software, data backup, and recovery — handled by DR runbook; BCP assumes and extends it.
- **SOC 2 A1.3** — Tests recovery plan procedures — testing cadence table.
- **HIPAA §164.308(a)(7)(i)** — Contingency plan — this document is a named component.
- **HIPAA §164.308(a)(7)(i)(E)** — Applications and data criticality analysis — BIA section.
- **GDPR Art. 32(1)(b)** — Ability to ensure ongoing confidentiality, integrity, availability — continuity strategies B–F.
- **GDPR Art. 32(1)(c)** — Ability to restore availability and access in a timely manner following a physical or technical incident — recovery & resumption section.

---

## Related Documents

| Plan | Scope | File |
|------|-------|------|
| Disaster Recovery | Technical infrastructure recovery (RTO/RPO, failover) | `disaster-recovery.md` |
| Incident Response | Security incidents, breach notification | `incident-response.md` |
| Business Continuity | BIA, vendor/staff/region continuity, comms | this file |

---

## Revision History

| Date | Change | Author |
|------|--------|--------|
| 2026-04-18 | Initial BCP (Phase 138) | Platform Engineering |
