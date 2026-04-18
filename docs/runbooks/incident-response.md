# ORDR-Connect — Security Incident Response Runbook

## Classification

| Field | Value |
|-------|-------|
| Severity | P0 — Critical |
| Compliance | HIPAA §164.308(a)(6)(i–ii), §164.402, §164.410 · ISO 27001 A.5.24–A.5.28 · SOC 2 CC7.3, CC7.4 · GDPR Art. 33–34 |
| Last tested | _YYYY-MM-DD_ |
| Owner | Security & Platform Engineering |
| Reviewers | Security, Compliance, Legal |
| Activation | Any alert matching the P0/P1 triggers below, or discovery of data exposure |

---

## Incident Severity Matrix

Matches CLAUDE.md incident classification; this runbook expands each tier into concrete actions.

| Severity | Description | Response Time | Target Resolution | Example Triggers |
|----------|-------------|---------------|-------------------|------------------|
| **P0 — Critical** | Data breach, PHI exposure, audit chain broken | 15 min page | 4 hours | Unauthorized PHI access · audit hash-chain mismatch · production RCE · mass credential leak |
| **P1 — High** | Auth bypass, agent safety failure, compliance violation | 1 hour | 24 hours | Agent exceeding permissions · kill switch not propagating · RLS bypass · exfil anomaly |
| **P2 — Medium** | Security scan failure, dependency CVE, SLO breach | 24 hours | 7 days | High-severity CVE · WAF signature failure · excessive failed logins · webhook HMAC mismatch |
| **P3 — Low** | Best-practice deviation, minor config issue | 1 week | 30 days | Missing rate limit on internal endpoint · overly permissive security group · stale dependency |

---

## Roles

| Role | Responsibility |
|------|----------------|
| **Incident Commander (IC)** | Owns the incident end-to-end. Declares severity, authorises containment, approves external comms. Rotates from on-call platform lead. |
| **Security Lead** | Forensics, scope determination, evidence collection, IOCs. |
| **Comms Lead** | Internal stakeholders, customer notifications, regulator notifications (breach). |
| **Scribe** | Maintains the incident timeline in the incident tracker. Every material action gets a timestamp. |
| **SME (per system)** | Platform engineer fluent in the affected subsystem (Kafka, Postgres, Agent Runtime, etc.). |

---

## Lifecycle

```
Detection → Triage → Containment → Eradication → Recovery → Post-Incident Review
                                       ↓
                                Notification (if breach)
```

Every stage transition must be logged in the incident tracker with a timestamp.

---

## Procedure 1 — Detection & Triage

**Trigger:** PagerDuty alert, customer report, internal flag, monitoring anomaly, audit chain break.

1. **Acknowledge alert in PagerDuty** within 5 minutes.
2. **Open an incident channel** (`#inc-<YYYYMMDD>-<short-slug>` in Slack).
3. **Assign IC** (default: on-call platform lead).
4. **Classify severity** using the matrix above. When in doubt, escalate one tier.
5. **Preserve evidence** — before any corrective action, snapshot:
   - Affected pod/container logs (`kubectl logs ... --previous` as well)
   - Database query logs (`pg_stat_statements` dump for affected tenant)
   - Kafka topic offsets (at alert time and now)
   - Audit log hash-chain head + Merkle root
   - Prometheus metrics for the 30 min window around the alert
6. **Confirm the blast radius**: which tenants, which PHI tables, which agents, which integrations.

**If classification is P0 and involves PHI:** notify General Counsel within 1 hour. The HIPAA 60-day breach notification clock starts at discovery, not at confirmation.

---

## Procedure 2 — Containment

Pick the **smallest** containment action that stops further harm. Do not containment-creep.

### A. Compromised tenant or agent

1. **Activate kill switch via Core** — issues an `IdentityCommand` with `action='revoke'`:
   ```bash
   # From the Synexiun Core admin CLI:
   synex-admin limbs revoke \
     --limb-id ordr-<tenant-id> \
     --reason "incident-<INC-ID>: <short-justification>"
   ```
   Limb's `IdentityCommandReceiver` polls every 15 s and calls
   `KillSwitchReceiver.activate()`. All significant operations begin to throw
   `KillSwitchActivatedError` within one poll cycle.
   (Implementation: `packages/kernel/src/identity-command-receiver.ts`.)

2. **Revoke agent credentials** — rotate any API keys, mTLS certs, or OAuth tokens
   scoped to the agent:
   ```bash
   pnpm --filter @ordr/api run cli -- api-keys revoke --agent-id <id>
   ```

3. **Lock the tenant in Admin Console** → Feature Flags → `tenant.frozen=true`.
   This gates all write endpoints via the compliance rules engine.

### B. Credential leak

1. **Rotate the secret immediately** via Vault (HashiCorp):
   ```bash
   vault write -f database/rotate-root/ordr-production
   vault write sys/leases/revoke-prefix/database/creds/ordr-app
   ```
2. **Invalidate sessions** — bump `jwt_key_epoch` so outstanding JWTs fail verification.
3. **Force password reset** for all affected users (WorkOS Directory Sync).

### C. Network attack / WAF event

1. **Tighten WAFv2 rate-limit rule** to the hostile CIDR or ASN (see
   `infrastructure/terraform/modules/waf`).
2. **Add IP to block list** via OPA policy in `security/policies/`.
3. **Enable Shield Advanced response team** (if available) for DDoS.

### D. Audit chain break

1. **Freeze writes to the affected tenant's audit partition** via feature flag.
2. **Do NOT modify audit tables** — WORM triggers block `UPDATE`/`DELETE`.
3. **Pull the S3 Object Lock replica** for the affected range:
   ```bash
   aws s3api list-objects-v2 \
     --bucket ordr-connect-audit-logs-production-$ACCOUNT_ID \
     --prefix "tenant/$TENANT_ID/" --start-after "<range-start>"
   ```
4. **Recompute hash chain** from the replica; identify the first broken link.
5. **Escalate to Security Lead** — a chain break is treated as an integrity breach
   until proven otherwise.

---

## Procedure 3 — Eradication

Only begin eradication once containment is verified.

1. **Identify root cause** — what allowed the incident. Document in the tracker.
2. **Patch** — deploy the fix via the standard CI/CD path (no manual production changes).
3. **Purge any attacker artefacts**:
   - Revoke persisted agent tokens, service-account keys, kubeconfigs.
   - Delete any data the attacker wrote that is not required for forensic retention.
   - Rotate any secret the attacker could have read.
4. **Harden** — add a compliance rule or OPA policy that makes the same class of
   incident detectable/blockable in future.
5. **Close detection gap** — add a Grafana alert or anomaly-detection signal that
   would catch this incident earlier next time.

---

## Procedure 4 — Recovery

1. **Restore service** — re-enable the tenant, revert any feature flag freeze, or
   redeploy clean agents. For kill-switched limbs, restart the process with a
   **fresh Ed25519 identity re-issued by Core** (kill switch is irreversible
   in-process).
2. **Replay events if needed** — Kafka retains 7 days; use
   `packages/events/src/replay.ts` to resync projections from a safe offset.
3. **Verify health** against the SLO dashboard before declaring the incident resolved.
4. **Monitor for recurrence** for 24 hours post-recovery.

---

## Procedure 5 — Breach Notification

**Required when confirmed unauthorised acquisition, access, use, or disclosure of PHI
occurred, or when personal data of EU residents was exposed.**

### HIPAA (§164.404 / §164.410)

| Audience | Deadline | Mechanism |
|----------|----------|-----------|
| Affected individuals | ≤ 60 calendar days from discovery | Written notice (mail / email if consented) |
| HHS Secretary (≥ 500 individuals) | ≤ 60 calendar days | HHS breach notification portal |
| HHS Secretary (< 500 individuals) | Annually | HHS breach notification portal |
| Prominent media (≥ 500 in one state) | ≤ 60 calendar days | Press release |
| Business Associates → Covered Entity | ≤ 60 calendar days | Contractual |

Discovery timestamp is when **any** employee knew or should have known. Start the
clock at the earliest detection signal, not at confirmation.

### GDPR (Art. 33 / 34)

| Audience | Deadline | Mechanism |
|----------|----------|-----------|
| Supervisory Authority | ≤ 72 hours from awareness | Via the designated DPA portal |
| Affected individuals | "without undue delay" when high risk | Direct communication |

Notification must include: nature, categories/approximate counts of records,
DPO contact, likely consequences, mitigation measures.

### Breach package contents

- Incident number, discovery timestamp, containment timestamp
- Nature of the compromised data (record types, field categories — never raw PHI)
- Count of affected records and individuals (approximate with ±10% is acceptable)
- Root cause and remediation summary
- Contact details for the DPO/Privacy Officer
- Mitigation steps the individual should take

Legal review required before any external notification is sent.

---

## Procedure 6 — Post-Incident Review

Within **5 business days** of resolution for P0/P1, 10 business days for P2.

1. **Blameless post-mortem** in the incident tracker. Template:
   - Timeline (every action from detection to resolution)
   - Impact (tenants, records, downtime, cost)
   - Root cause (technical + organisational)
   - What went well / what didn't
   - Action items (owner, due date, tracker link)
2. **File action items as GitHub issues** with `incident-followup` label.
3. **Update this runbook** if gaps were exposed.
4. **Share with all engineering** — no attribution to individuals.
5. **Compliance evidence**: attach the post-mortem PDF to the SOC 2 / ISO 27001
   audit folder in the compliance drive.

---

## Key Subsystem References

| Subsystem | Containment Lever | File |
|-----------|-------------------|------|
| Kill switch | `IdentityCommandReceiver` (revoke) | `packages/kernel/src/identity-command-receiver.ts` |
| Budget starvation | `BudgetAllocationReceiver` (set budget=0) | `packages/kernel/src/budget-allocation-receiver.ts` |
| Audit chain verification | Merkle verifier | `packages/audit/src/merkle.ts` |
| Feature flag freeze | `feature_flags` table, `tenant.frozen` | `apps/api/src/routes/feature-flags.ts` |
| Secret rotation | Vault client | `packages/auth/src/vault-client.ts` |
| WAF rule update | WAFv2 module | `infrastructure/terraform/modules/waf/` |

---

## Testing Cadence

| Exercise | Frequency | Owner |
|----------|-----------|-------|
| Tabletop (P0 PHI exposure) | Quarterly | Security Lead |
| Kill-switch drill (revoke a synthetic limb) | Quarterly | Platform |
| Breach notification dry-run (HIPAA + GDPR) | Annually | Compliance + Legal |
| Detection-to-containment time measurement | Per incident | IC |

Update `Last tested` metadata at the top of this file after each exercise. Document
outcomes in the compliance tracker (SOC 2 evidence).

---

## Escalation Chain

| Level | Contact | Response Time | Authority |
|-------|---------|---------------|-----------|
| L1 — On-call engineer | PagerDuty rotation | 5 minutes | Tactical response |
| L2 — Platform lead | Direct page | 15 minutes | Incident Commander |
| L3 — CTO | Phone | 30 minutes | Override authority, external comms |
| L4 — CEO + General Counsel | Phone | 1 hour | Regulator notifications, press |
| L5 — External counsel / forensics | Contract retainer | Per SLA | Legal strategy, attorney-client privilege |

---

## Compliance Mapping

- **HIPAA §164.308(a)(6)(i)** — Security incident procedures — this document.
- **HIPAA §164.308(a)(6)(ii)** — Identify, respond, mitigate, document — procedures 1–6.
- **HIPAA §164.402, §164.404, §164.410** — Breach notification — Procedure 5.
- **ISO 27001 A.5.24** — Information security incident management planning.
- **ISO 27001 A.5.25** — Assessment and decision on information security events.
- **ISO 27001 A.5.26** — Response to information security incidents.
- **ISO 27001 A.5.27** — Learning from information security incidents.
- **ISO 27001 A.5.28** — Collection of evidence.
- **SOC 2 CC7.3** — System security incidents are identified, analyzed, and responded to.
- **SOC 2 CC7.4** — Incidents are evaluated for severity and escalated.
- **GDPR Art. 33** — Notification of a personal data breach to the supervisory authority.
- **GDPR Art. 34** — Communication of a personal data breach to the data subject.

---

## Revision History

| Date | Change | Author |
|------|--------|--------|
| 2026-04-18 | Initial runbook (Phase 135) | Platform Engineering |
