# ORDR-Connect — Subprocessor Register

> **Purpose.** This register discloses every third-party processor that may
> process customer or data-subject personal data on behalf of ORDR-Connect.
> It exists to satisfy **GDPR Art. 28** (processor transparency), **CCPA/CPRA**
> service-provider disclosure, **SOC 2 CC9.2** (vendor risk management),
> **HIPAA §164.308(b)** (BAA roster), and **ISO 27001:2022 A.5.19 – A.5.22**
> (supplier relationships).

> **Scope.** Every vendor that can technically receive customer data — whether
> or not a given tenant actually uses the feature — is listed. Vendors used
> only for internal-facing functions with no customer-data exposure (e.g.,
> corporate accounting) are out of scope.

---

## Summary

| # | Vendor | Service | Data Category | Region | Certifications | BAA / DPA | Status |
|---|--------|---------|---------------|--------|----------------|-----------|--------|
| 1 | Amazon Web Services, Inc. | Compute, storage, KMS, S3 Object Lock | RESTRICTED · CONFIDENTIAL · INTERNAL | US-East-1 (primary), US-West-2 (DR) | SOC 2 Type II · ISO 27001 · ISO 27017 · ISO 27018 · HIPAA-eligible | BAA executed · DPA standard clauses | Active |
| 2 | Confluent, Inc. | Managed Apache Kafka (event sourcing backbone) | RESTRICTED · CONFIDENTIAL · INTERNAL | US-East-1 (AWS-hosted) | SOC 2 Type II · ISO 27001 · HIPAA-eligible | BAA executed · DPA standard clauses | Active |
| 3 | Neo4j, Inc. | Aura managed graph database (Customer Graph) | CONFIDENTIAL · INTERNAL | AWS US-East-1 | SOC 2 Type II · ISO 27001 · GDPR DPA | DPA executed | Active |
| 4 | ClickHouse, Inc. | ClickHouse Cloud (analytics warehouse) | CONFIDENTIAL · INTERNAL | AWS US-East-1 | SOC 2 Type II · ISO 27001 | DPA executed | Active |
| 5 | Upstash, Inc. | Serverless Redis (cache, rate-limit, session) | INTERNAL (non-PHI by policy) | AWS US-East-1 | SOC 2 Type II · ISO 27001 · GDPR DPA | DPA executed | Active |
| 6 | WorkOS, Inc. | SSO / SCIM / directory sync | CONFIDENTIAL | US (multi-AZ) | SOC 2 Type II · ISO 27001 | DPA executed | Active |
| 7 | Twilio Inc. | SMS, voice, IVR programmable messaging | RESTRICTED (may carry PHI per tenant use) · CONFIDENTIAL | US (default) · global edge | SOC 2 Type II · ISO 27001 · HIPAA BAA | BAA executed · DPA executed | Active |
| 8 | Twilio SendGrid, Inc. | Transactional and marketing email | RESTRICTED (may carry PHI per tenant use) · CONFIDENTIAL | US | SOC 2 Type II · ISO 27001 | BAA executed · DPA executed | Active |
| 9 | Anthropic, PBC | Claude API (LLM agent reasoning) | CONFIDENTIAL (prompts may carry operational context — PHI redacted before send) | US | SOC 2 Type II · HIPAA offered on enterprise | BAA executed · DPA executed | Active |
| 10 | OpenAI, L.L.C. | GPT API (fallback LLM, ungated gated by tenant policy) | CONFIDENTIAL (prompts PHI-redacted) | US | SOC 2 Type II | DPA executed · BAA (ZDR enterprise tier) | Active (optional) |
| 11 | Clearbit (HubSpot, Inc.) | Company (firmographic) enrichment | INTERNAL (domain-only; no personal data sent) | US | SOC 2 Type II | DPA executed | Active |
| 12 | HashiCorp, Inc. | Vault secret management (self-hosted image; enterprise support subscription) | CONFIDENTIAL · RESTRICTED (keys + secrets) | In-region with our AWS VPC | SOC 2 Type II · ISO 27001 | DPA executed | Active |
| 13 | Functional Software, Inc. (Sentry) | Error tracking, performance monitoring | INTERNAL (stack traces PII/PHI-scrubbed pre-send) | US (SaaS) | SOC 2 Type II · ISO 27001 · ISO 27018 · GDPR DPA | DPA executed | Active |
| 14 | Datadog, Inc. | Metrics, logs, APM | INTERNAL (logs PII/PHI-scrubbed pre-send; metrics non-PII) | US | SOC 2 Type II · ISO 27001 · HIPAA BAA available | DPA executed · BAA executed | Active |
| 15 | Grafana Labs, Inc. | Grafana Cloud dashboards (management plane; self-hosted Prometheus + Loki for data) | INTERNAL (metadata only) | US / EU (per plan) | SOC 2 Type II · ISO 27001 | DPA executed | Active |
| 16 | GitHub, Inc. (Microsoft) | Source-code hosting, Actions CI/CD, Dependabot | CONFIDENTIAL (source code + build artefacts; no customer data) | US | SOC 2 Type II · ISO 27001 · HIPAA-eligible | DPA executed | Active |
| 17 | Snyk Ltd. | Dependency + container vulnerability scanning | INTERNAL (manifest metadata) | UK / US | SOC 2 Type II · ISO 27001 · GDPR DPA | DPA executed | Active |
| 18 | Sigstore (OpenSSF) | Artefact signing (cosign) | PUBLIC (signatures on build artefacts) | Multi-region public transparency log | Open-source infrastructure · CNCF-governed | n/a (public log) | Active |

---

## Data-Category Matrix

| Category | Definition | Who Can Receive |
|----------|------------|-----------------|
| **PUBLIC** | Marketing pages, public API docs | Anyone |
| **INTERNAL** | Business metrics, operational metadata, non-PII | Infrastructure, observability, CI/CD |
| **CONFIDENTIAL** | PII (name, email, phone, business contact) | All except public-only services |
| **RESTRICTED** | PHI, financial data, credentials, encryption keys | Only HIPAA-eligible subprocessors with BAA |

A vendor is permitted to process a category **only** if its BAA / DPA
explicitly authorises it. The platform enforces this technically through
egress policies, PII scrubbing, and per-vendor encryption envelopes.

---

## HIPAA-Eligible Subprocessors (with executed BAA)

The following subprocessors are authorised to receive data classified
**RESTRICTED** (PHI). All others are prohibited from receiving PHI by
technical egress controls and audit-logged policy:

1. Amazon Web Services, Inc.
2. Confluent, Inc.
3. Twilio Inc. (programmable messaging + voice)
4. Twilio SendGrid, Inc. (email)
5. Anthropic, PBC (Claude API — enterprise HIPAA tier)
6. Datadog, Inc.

OpenAI is authorised only under the Zero-Data-Retention enterprise tier and
only for tenants who have explicitly opted in via the feature flag
`ai.openai_fallback_enabled`. Otherwise its BAA status is treated as absent.

All remaining subprocessors are denied PHI by both contractual and technical
controls. PHI destined for such services is either withheld entirely
(Clearbit never receives personal data) or scrubbed at the edge (Sentry /
Grafana Cloud / GitHub — stack traces and metrics strip PII/PHI by the
redaction middleware before egress; see `packages/observability/src/redactor.ts`).

---

## Change Notification

**Tenants are notified of subprocessor additions and removals no less than
30 days before the change takes effect,** except where a vendor must be
replaced on an emergency basis (e.g., solvency event, security incident, or
legal mandate) — in which case notification is issued as soon as practicable,
with a post-hoc explanation of the triggering condition.

Notification channels:

- **Primary:** Email to the tenant's designated Compliance Contact on record.
- **Secondary:** In-product notice in the Tenant Settings → Compliance tab.
- **Tertiary:** Published update to this register (always the authoritative
  current state).

Tenants whose contracts grant them approval rights (typically Enterprise
tier with an executed MSA carrying a subprocessor-approval clause) may
object to a proposed addition within the 30-day window by emailing
`compliance@ordr-connect.com`. Unresolved objections trigger the right to
terminate the impacted service without penalty.

---

## Review Cadence

| Action | Frequency | Owner |
|--------|-----------|-------|
| Register review & sign-off | Quarterly | Compliance Lead |
| Vendor certification re-verification | Annually (on each vendor's attestation cycle) | Compliance Lead |
| BAA / DPA renewal check | Annually or on contract-date anniversary, whichever is sooner | Legal |
| Subprocessor risk re-assessment | Annually, or on any major vendor security event | Security Engineering |
| Tenant-facing publication | On every change to the table above | Compliance Lead |

The Compliance Lead maintains the authoritative evidence binder with each
vendor's current SOC 2 report, ISO 27001 certificate, executed BAA / DPA,
and most recent risk assessment. This register is a public summary; the
binder is the auditable archive.

---

## How We Select a New Subprocessor

1. **Business need identified** by a service owner.
2. **Security questionnaire** issued to vendor (CAIQ v4 or equivalent).
3. **Vendor-provided evidence reviewed:** SOC 2 Type II report, ISO 27001
   certificate (and Statement of Applicability), penetration-test summary,
   recent incident history, data-residency attestation.
4. **Risk score** computed against our vendor-risk rubric (see
   `security/threat-models/vendor-risk-rubric.md` — *scheduled*).
5. **DPA executed**; **BAA executed** if PHI exposure is contemplated.
6. **Egress policy updated** to authorise the new destination (`network-policy.rego`
   Gatekeeper rule + AWS egress security-group update).
7. **PII/PHI handling documented** in the relevant service's threat model.
8. **Register entry added** here, tenant notification sent (30-day lead time).
9. **Go-live after lead time** expires and no blocking tenant objection remains.

---

## How We Retire a Subprocessor

1. Identify replacement (if functional need persists) and run the
   selection procedure above.
2. Migrate data and traffic; verify parity.
3. Obtain attestation from departing vendor that all residual customer
   data has been deleted per contract (typically 30-day post-termination).
4. Update this register (remove row; add deletion-attestation pointer
   to evidence binder).
5. Revoke vendor credentials; remove egress rules.

---

## Related Documents

- [`docs/compliance/evidence-index.md`](./evidence-index.md) — Master auditor
  walkthrough index.
- [`security/policies/network-policy.rego`](../../security/policies/network-policy.rego)
  — Egress control (technical enforcement of this register).
- [`docs/runbooks/business-continuity.md`](../runbooks/business-continuity.md)
  — Vendor fallback matrix for continuity planning.
- [`docs/runbooks/incident-response.md`](../runbooks/incident-response.md)
  — Vendor-originated incident handling.

---

## Revision History

| Date | Change | Author |
|------|--------|--------|
| 2026-04-18 | Initial register (Phase 141) | Compliance + Platform Engineering |
