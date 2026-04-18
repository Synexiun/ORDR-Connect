# ORDR-Connect — Compliance Evidence Index

## Purpose

This document maps each audit control from our three certification scopes to
the specific file, directory, or process in this repository that provides
evidence for it. Auditors use this as the primary walkthrough; engineers use
it to understand where compliance obligations live in code.

Every row links to working code, a tested runbook, or an infrastructure
artefact. Rows without links indicate a gap — those are tracked at the bottom.

Scope:

- **SOC 2 Type II** — Trust Services Criteria (Security, Availability,
  Processing Integrity, Confidentiality, Privacy)
- **ISO 27001:2022** — Annex A controls A.5 (Organizational), A.6 (People),
  A.7 (Physical), A.8 (Technological)
- **HIPAA** — Technical §164.312, Administrative §164.308, Physical §164.310
- **GDPR** — Articles 5, 25, 30, 32, 33, 34, 44+

---

## SOC 2 Common Criteria (Security)

### CC1 — Control Environment

| Control | Evidence | File / Artefact |
|---------|----------|-----------------|
| CC1.1 Integrity & ethics | Engineering guidelines | [`CLAUDE.md`](../../CLAUDE.md) |
| CC1.2 Board oversight | Quarterly security review cadence | `docs/runbooks/business-continuity.md` (Testing Cadence) |
| CC1.3 Management structure | Service catalogue with owners | Runbook Roles section ([IR](../runbooks/incident-response.md), [BCP](../runbooks/business-continuity.md)) |
| CC1.4 Attract / develop competent personnel | Onboarding runbook + peer-review cadence | [BCP §D](../runbooks/business-continuity.md) |
| CC1.5 Accountability | Code review + 2-person approval | Git branch protection rules, CODEOWNERS |

### CC2 — Communication & Information

| Control | Evidence | File / Artefact |
|---------|----------|-----------------|
| CC2.1 Information relevance | Audit log format + SIEM correlation | [`packages/audit/`](../../packages/audit/) |
| CC2.2 Internal communication | Incident channel convention | [`docs/runbooks/incident-response.md`](../runbooks/incident-response.md) Procedure 1 |
| CC2.3 External communication | Status page + customer notification templates | [`docs/runbooks/business-continuity.md`](../runbooks/business-continuity.md) Comms section |

### CC3 — Risk Assessment

| Control | Evidence | File / Artefact |
|---------|----------|-----------------|
| CC3.1 Risk identification | STRIDE threat models | [`security/threat-models/`](../../security/threat-models/) |
| CC3.2 Risk analysis | Business Impact Analysis | [BCP BIA table](../runbooks/business-continuity.md) |
| CC3.3 Fraud risk | Anomaly detection + DLP | [`packages/security/`](../../packages/security/) |
| CC3.4 Change in risk | Quarterly threat-model review | Testing cadence tables |

### CC4 — Monitoring Activities

| Control | Evidence | File / Artefact |
|---------|----------|-----------------|
| CC4.1 Ongoing / separate evaluation | SIEM + Grafana + Prometheus | `infrastructure/terraform/modules/observability/` |
| CC4.2 Evaluation communication | Alert routing to oncall | PagerDuty config |

### CC5 — Control Activities

| Control | Evidence | File / Artefact |
|---------|----------|-----------------|
| CC5.1 Control selection | OPA policy catalogue | [`security/policies/README.md`](../../security/policies/README.md) |
| CC5.2 General technology controls | Encryption + access control implementation | [`packages/crypto/`](../../packages/crypto/) + [`packages/auth/`](../../packages/auth/) |
| CC5.3 Policies & procedures | This index + runbooks + policy READMEs | `docs/` + `security/` |

### CC6 — Logical & Physical Access

| Control | Evidence | File / Artefact |
|---------|----------|-----------------|
| CC6.1 Logical access restriction | RLS + RBAC + tenant isolation | [`packages/auth/`](../../packages/auth/) + [`security/policies/tenant-isolation.rego`](../../security/policies/tenant-isolation.rego) |
| CC6.2 New access / periodic review | WorkOS SCIM + periodic access review | [`packages/auth/src/workos-*.ts`](../../packages/auth/src/) |
| CC6.3 Authorization for role creation | RBAC policy governance | [`security/policies/README.md`](../../security/policies/README.md) (Governance Process) |
| CC6.4 Physical access | Cloud-only; no physical infra | N/A — AWS inherited controls |
| CC6.5 Logical access removal | Kill switch + revocation | [`packages/kernel/src/identity-command-receiver.ts`](../../packages/kernel/src/identity-command-receiver.ts) |
| CC6.6 Edge protection | WAF + TOR blocking + rate limiting | [`infrastructure/terraform/modules/waf/`](../../infrastructure/terraform/modules/waf/) + [`packages/security/src/tor-exit-refresher.ts`](../../packages/security/src/tor-exit-refresher.ts) |
| CC6.7 Data transmission / disposal | TLS 1.3 + field encryption + cryptographic erasure | [`packages/crypto/`](../../packages/crypto/) |
| CC6.8 Malicious code | Container scanning + dependency scanning | `.github/workflows/` CI jobs |

### CC7 — System Operations

| Control | Evidence | File / Artefact |
|---------|----------|-----------------|
| CC7.1 Detection / monitoring | Attack detector + anomaly detector | [`packages/security/`](../../packages/security/) |
| CC7.2 Security monitoring | WORM audit + Merkle chain | [`packages/audit/src/merkle.ts`](../../packages/audit/src/merkle.ts) |
| CC7.3 Security incidents identified, analysed, responded | Incident response runbook | [`docs/runbooks/incident-response.md`](../runbooks/incident-response.md) |
| CC7.4 Incidents evaluated and escalated | Severity matrix + escalation chain | IR Procedure 1 + Escalation Chain |
| CC7.5 Recovery from incidents | DR runbook + recovery procedures | [`docs/runbooks/disaster-recovery.md`](../runbooks/disaster-recovery.md) |

### CC8 — Change Management

| Control | Evidence | File / Artefact |
|---------|----------|-----------------|
| CC8.1 Changes authorized | Git protected branches + PR review | GitHub branch protection |

### CC9 — Risk Mitigation

| Control | Evidence | File / Artefact |
|---------|----------|-----------------|
| CC9.1 Risk mitigation activities | Vendor fallback matrix | [BCP §B](../runbooks/business-continuity.md) |
| CC9.2 Vendor management | Subprocessor register | TODO — see Gaps below |

---

## SOC 2 Additional Criteria

### Availability (A1)

| Control | Evidence | File / Artefact |
|---------|----------|-----------------|
| A1.1 Capacity management | K8s HPA + ClickHouse scaling | `infrastructure/kubernetes/` |
| A1.2 Environmental / backup / recovery | DR runbook + multi-AZ + cross-region replica | [DR runbook](../runbooks/disaster-recovery.md) |
| A1.3 Recovery plan testing | Quarterly DR tabletops + annual full exercise | DR + BCP testing cadence |

### Processing Integrity (PI1)

| Control | Evidence | File / Artefact |
|---------|----------|-----------------|
| PI1.1 Processing objectives met | Input validation + schema enforcement | Zod schemas across packages |
| PI1.2 Inputs complete & accurate | JSON Schema + Drizzle type safety | [`packages/core/`](../../packages/core/) |
| PI1.3 Processing complete / accurate / timely | Kafka event sourcing + projection verification | [`packages/events/`](../../packages/events/) |
| PI1.4 Outputs complete & accurate | DLP + compliance rules engine | [`packages/compliance/`](../../packages/compliance/) |
| PI1.5 Errors identified & corrected | Structured error types + correlation IDs | [`packages/core/src/errors.ts`](../../packages/core/src/errors.ts) |

### Confidentiality (C1)

| Control | Evidence | File / Artefact |
|---------|----------|-----------------|
| C1.1 Confidential data identified | Data classification types | [`packages/core/src/types/data-classification.ts`](../../packages/core/src/types/data-classification.ts) |
| C1.2 Confidential data disposed securely | Cryptographic erasure | [`packages/crypto/`](../../packages/crypto/) |

### Privacy (P1–P8)

| Control | Evidence | File / Artefact |
|---------|----------|-----------------|
| P1.1 Notice of privacy practices | Privacy policy (customer-facing) | TODO — see Gaps below |
| P2.1 Choice & consent | Consent management rules | [`packages/compliance/`](../../packages/compliance/) |
| P3.1 Personal data collection | DLP scanning at ingest | [`packages/security/src/dlp-*.ts`](../../packages/security/src/) |
| P4.1 Use, retention, disposal | Retention rules + cryptographic erasure | Compliance engine |
| P5.1 Access (individual rights) | DSR flow | TODO — see Gaps below |
| P6.1 Disclosure to third parties | BAA + subprocessor register | TODO — see Gaps below |
| P7.1 Quality | Data validation on ingest | Schema validation |
| P8.1 Monitoring & enforcement | Privacy rule audit chain | [`packages/audit/`](../../packages/audit/) |

---

## ISO 27001:2022 Annex A

### A.5 Organizational Controls (highlights)

| Control | Title | Evidence |
|---------|-------|----------|
| A.5.1 | Policies for information security | [`CLAUDE.md`](../../CLAUDE.md) + this index |
| A.5.9 | Inventory of information and associated assets | Service catalogue + data classification |
| A.5.10 | Acceptable use | [`CLAUDE.md`](../../CLAUDE.md) Mandatory Rules |
| A.5.13 | Labelling of information | Data classification types |
| A.5.15 | Access control | [`packages/auth/`](../../packages/auth/) |
| A.5.23 | Information security for cloud services | Terraform + AWS controls |
| A.5.24 | Incident management planning | [IR runbook](../runbooks/incident-response.md) |
| A.5.25 | Assessment and decision on events | IR Procedure 1 |
| A.5.26 | Response to incidents | IR Procedures 2–4 |
| A.5.27 | Learning from incidents | IR Procedure 6 |
| A.5.28 | Collection of evidence | IR Preserve Evidence section |
| A.5.29 | Information security during disruption | [BCP runbook](../runbooks/business-continuity.md) |
| A.5.30 | ICT readiness for business continuity | BCP BIA + strategies |
| A.5.31 | Legal, statutory, regulatory, contractual requirements | This index (compliance mapping) |
| A.5.32 | Intellectual property rights | License compliance (Rule 8 in CLAUDE.md) |
| A.5.33 | Protection of records | WORM audit + retention policy |
| A.5.34 | Privacy and protection of PII | Data classification + field encryption |

### A.8 Technological Controls (highlights)

| Control | Title | Evidence |
|---------|-------|----------|
| A.8.2 | Privileged access rights | RBAC + MFA on admin |
| A.8.3 | Information access restriction | RLS + policy engine |
| A.8.5 | Secure authentication | OAuth 2.1 + PKCE + Argon2id |
| A.8.9 | Configuration management | Terraform + version-pinned dependencies |
| A.8.10 | Information deletion | Cryptographic erasure |
| A.8.11 | Data masking | DLP + PHI masking in non-prod |
| A.8.12 | Data leakage prevention | [`packages/security/src/dlp-*.ts`](../../packages/security/src/) |
| A.8.15 | Logging | WORM audit chain |
| A.8.16 | Monitoring activities | SIEM + Grafana |
| A.8.20 | Network security | WAF + TOR feed + NetworkPolicies |
| A.8.23 | Web filtering | WAF + TOR feed |
| A.8.24 | Use of cryptography | AES-256-GCM + TLS 1.3 + field encryption |
| A.8.25 | Secure development lifecycle | CI gates + code review |
| A.8.26 | Application security requirements | Zod + OPA policies |
| A.8.28 | Secure coding | Linting + type checking + compliance gates |
| A.8.29 | Security testing | Unit + integration + security test suites |

---

## HIPAA

### Administrative Safeguards §164.308

| Section | Requirement | Evidence |
|---------|-------------|----------|
| §164.308(a)(1)(i) | Security Management Process | Runbooks + governance |
| §164.308(a)(1)(ii)(A) | Risk Analysis | Threat models |
| §164.308(a)(1)(ii)(D) | Information system activity review | Audit chain reviews |
| §164.308(a)(3) | Workforce Security | WorkOS SCIM + access review |
| §164.308(a)(4) | Information Access Management | RBAC + minimum necessary |
| §164.308(a)(5) | Security Awareness and Training | Engineering rules (CLAUDE.md) + onboarding |
| §164.308(a)(6) | Security Incident Procedures | [IR runbook](../runbooks/incident-response.md) |
| §164.308(a)(7) | Contingency Plan | [DR](../runbooks/disaster-recovery.md) + [BCP](../runbooks/business-continuity.md) |
| §164.308(a)(7)(i)(E) | Applications & Data Criticality | BCP BIA table |
| §164.308(a)(8) | Periodic evaluation | Quarterly audits |
| §164.308(b) | Business Associate Contracts | TODO — see Gaps below |

### Technical Safeguards §164.312

| Section | Requirement | Evidence |
|---------|-------------|----------|
| §164.312(a)(1) | Access Control | RLS + RBAC + policies |
| §164.312(a)(2)(i) | Unique User Identification | WorkOS + JWT tid/uid |
| §164.312(a)(2)(iii) | Automatic Logoff | Session TTL |
| §164.312(a)(2)(iv) | Encryption and Decryption | [`packages/crypto/`](../../packages/crypto/) |
| §164.312(b) | Audit Controls | WORM + Merkle |
| §164.312(c)(1) | Integrity | Hash chain + verification |
| §164.312(d) | Person or Entity Authentication | OAuth + mTLS + MFA |
| §164.312(e)(1) | Transmission Security | TLS 1.3 |

### Breach Notification §164.400–414

| Section | Requirement | Evidence |
|---------|-------------|----------|
| §164.404 | Notification to individuals | [IR Procedure 5](../runbooks/incident-response.md) |
| §164.406 | Notification to media | IR Procedure 5 |
| §164.408 | Notification to HHS | IR Procedure 5 |
| §164.410 | Notification by business associate | Contractual template |

---

## GDPR (selected articles)

| Article | Title | Evidence |
|---------|-------|----------|
| Art. 5 | Principles | Data classification + minimum necessary + retention |
| Art. 25 | Data protection by design | Encryption by default + RLS at DB |
| Art. 30 | Records of processing | Audit chain |
| Art. 32 | Security of processing | Encryption + backup + continuity |
| Art. 32(1)(b) | Ongoing CIA | [BCP](../runbooks/business-continuity.md) |
| Art. 32(1)(c) | Restore availability timely | [DR](../runbooks/disaster-recovery.md) |
| Art. 33 | Breach notification to supervisory authority | [IR Procedure 5](../runbooks/incident-response.md) |
| Art. 34 | Breach communication to data subject | IR Procedure 5 |
| Art. 35 | Data protection impact assessment | Per-feature DPIA in threat-models |
| Art. 44+ | International transfers | BAA + region pinning |

---

## Gaps (Evidence Still to Collect)

| Item | Control(s) | Owner | Target |
|------|------------|-------|--------|
| Annual third-party penetration test | Rule 10, SOC 2 CC4.1, ISO A.8.29 | Security Lead | Q3 2026 |
| Subprocessor register | CC9.2, P6.1, HIPAA §164.308(b) | Compliance + Legal | Q2 2026 |
| External-facing privacy policy | P1.1 | Legal + Marketing | Q2 2026 |
| DSR (Data Subject Request) endpoint | P5.1, GDPR Art. 15–22 | Platform | Q2 2026 |
| CCPA / CPRA rule set | State privacy | Compliance + Platform | Q3 2026 |
| BAA templates executed with all PHI vendors | HIPAA §164.308(b) | Legal | Continuous |
| SOC 2 Type II attestation report | — | External auditor | Year-end 2026 |
| ISO 27001 certification | — | External auditor | Year-end 2026 |

This gap list is the canonical source for compliance-driven roadmap work.

---

## How to Use This Index

**For auditors:** Each row points to a working artefact you can inspect. Click
through to the evidence. If a row says TODO or appears in the Gap list, that
control is not yet satisfied and is on the remediation plan.

**For engineers:** When adding a feature that touches a compliance domain,
find the relevant row and ensure your change keeps the cited evidence valid.
If your change introduces a new control obligation, add a row — the auditor
and the next engineer will thank you.

**For the compliance team:** Use this as the master index for evidence
collection binders. Pair each row with a screenshot, log export, or policy
extract per the audit engagement letter.

---

## Related Documents

- [`CLAUDE.md`](../../CLAUDE.md) — Mandatory development rules (one-per-compliance-theme)
- [`docs/runbooks/disaster-recovery.md`](../runbooks/disaster-recovery.md)
- [`docs/runbooks/incident-response.md`](../runbooks/incident-response.md)
- [`docs/runbooks/business-continuity.md`](../runbooks/business-continuity.md)
- [`security/policies/README.md`](../../security/policies/README.md)
- [`security/threat-models/`](../../security/threat-models/)

---

## Revision History

| Date | Change | Author |
|------|--------|--------|
| 2026-04-18 | Initial evidence index (Phase 140) | Platform Engineering |
