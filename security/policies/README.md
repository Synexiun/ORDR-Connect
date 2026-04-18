# ORDR-Connect — Security Policy Governance (OPA/Rego)

## Purpose

This directory contains the OPA (Open Policy Agent) / Rego policies that encode
ORDR-Connect's authorization, isolation, safety, and compliance rules as
executable code. Every policy file in this directory is a **gate** — requests
that a policy denies must never proceed, regardless of code-path.

Policies are the last line of defense behind application-layer RBAC/ABAC and
database RLS. They exist to:

1. Enforce compliance controls that transcend individual service boundaries.
2. Remain readable to auditors (Rego is intentionally declarative).
3. Allow security and compliance changes without redeploying business services.

---

## Policy Catalogue

| File | Scope | Enforcement Point | CLAUDE.md Rule | Compliance |
|------|-------|-------------------|----------------|------------|
| [`tenant-isolation.rego`](tenant-isolation.rego) | Every tenant-scoped API call and DB query | API middleware (OPA sidecar) + Envoy | Rule 2 | SOC 2 CC6.1 · ISO 27001 A.9.4.1 · HIPAA §164.312(a)(1) |
| [`phi-access-control.rego`](phi-access-control.rego) | Any endpoint or query touching RESTRICTED data | API middleware + DB proxy | Rule 6 | HIPAA §164.312 · §164.502(b) · SOC 2 CC6.1 · ISO 27001 A.8.2.3 |
| [`agent-permissions.rego`](agent-permissions.rego) | Every agent action and tool invocation | Agent runtime (pre-execution hook) | Rule 9 | SOC 2 CC6.3 · HIPAA §164.312(a)(1) |
| [`audit-completeness.rego`](audit-completeness.rego) | Every state-changing operation | Post-commit audit emitter | Rule 3 | SOC 2 CC7.2 · ISO 27001 A.12.4.1 · HIPAA §164.312(b) |
| [`data-encryption.rego`](data-encryption.rego) | Persistence writes for RESTRICTED data | ORM middleware (Drizzle hook) | Rule 1 | SOC 2 CC6.7 · ISO 27001 A.10.1.1 · HIPAA §164.312(a)(2)(iv) |
| [`api-security.rego`](api-security.rego) | Ingress on all customer-facing APIs | Envoy + Hono middleware | Rule 4 | SOC 2 CC6.6 · ISO 27001 A.13.1.3 |
| [`network-policy.rego`](network-policy.rego) | Kubernetes NetworkPolicy admission | OPA Gatekeeper (admission webhook) | Rule 10 | SOC 2 CC6.6 · ISO 27001 A.13.1.3 |
| [`container-security.rego`](container-security.rego) | Pod admission (non-root, read-only FS, capability drop) | OPA Gatekeeper | Rule 10 · Rule 8 | SOC 2 CC6.8 · ISO 27001 A.12.5.1 · A.14.2.5 |

Each policy file begins with a header linking to the controls it satisfies. Any
change to a compliance-mapping block requires Compliance review (see below).

---

## Evaluation Model

Policies use `default allow := false` — **deny by default**. A request
succeeds only if at least one explicit `allow` rule matches AND no `deny`
rule matches. Where both `allow` and `deny` rules exist, `deny` wins: the
calling layer evaluates deny rules first and short-circuits on any match.

Each call site provides a typed `input` document (JWT claims, request
parameters, resource metadata) and reads organizational data from OPA's
bundled `data` document (role definitions, allowed tools, tenant roster).

Performance envelope: every policy is expected to evaluate in < 1 ms on p99
for typical input sizes. Policies that grow beyond that must be partitioned
or moved to a precomputed decision cache.

---

## Governance Process

### Adding a new policy

1. **Write a threat-model note** (under `security/threat-models/`) explaining
   the risk being addressed and why application-layer enforcement is
   insufficient.
2. **Draft the `.rego` file** following the conventions below.
3. **Add a row to the catalogue above** with scope, enforcement point, rule
   reference, and compliance mapping.
4. **Author test cases** under `security/policies/tests/` covering at least
   one allow path and one deny path per rule.
5. **Obtain approvals**: 1 Security reviewer + 1 Compliance reviewer + 1
   Platform Engineering reviewer (three distinct people).
6. **Canary**: deploy to staging for ≥ 7 days with decision logs streamed to
   SIEM. Any unexpected deny rate > 0.1% requires investigation before
   production rollout.

### Modifying an existing policy

Any change that loosens enforcement (new `allow`, weakened `deny`) requires
the full new-policy approval chain above.

Any change that tightens enforcement (new `deny`, stricter `allow` predicate)
requires Security + Platform approval and canary; Compliance is informed but
does not block unless compliance mapping changes.

Trivial refactors (rename, comment, test-only) require standard code review.

### Retiring a policy

1. Document the replacement control (application layer, OPA bundle swap, etc.)
   in the threat-model note.
2. Run both old and new controls in parallel for ≥ 30 days with decision logs
   compared for drift.
3. Remove only after Security, Compliance, and Platform confirm zero
   regressions and zero decision drift.

### Emergency changes

P0 security incidents may require immediate policy changes. In that case:

1. The Incident Commander may approve a single-reviewer merge.
2. The policy change is tagged `emergency/<incident-id>` in commit message.
3. A retroactive full-approval review is filed within 5 business days
   (post-incident review cadence — see `docs/runbooks/incident-response.md`).

---

## Testing Requirements

Every policy has a companion test file exercising:

- **Golden path**: a canonical input that the policy must allow.
- **Negative paths**: inputs that must be denied (one per explicit `deny`).
- **Boundary cases**: empty strings, missing fields, wrong types, oversized
  inputs — these should deny gracefully, never panic.
- **Compliance assertion**: a comment block linking each test to the
  specific control it demonstrates (e.g., `# HIPAA §164.312(a)(1)`).

CI runs `opa test security/policies/` on every PR. Failing tests block merge.
Policies also run `opa check --strict` for parse and type cleanliness, and
`opa eval --benchmark` for performance regression detection on any file that
grew by more than 20 lines.

---

## Conventions

- **Package naming**: `ordr.<snake_case_scope>` — e.g., `ordr.tenant_isolation`.
- **Default rule**: every decision starts with `default allow := false` or
  `default deny := set()`. No policy may rely on implicit defaults.
- **Rule granularity**: one `allow` or `deny` per distinct logical rule. Do
  not compose multiple independent conditions into a single rule.
- **Deny messages**: every `deny[msg]` must produce a human-readable reason
  that references the rule number or compliance citation, not code internals.
- **No side effects**: policies are pure decisions. No HTTP calls, no time
  reads (use `input.now` provided by the caller instead), no randomness.
- **External data**: only read from `data.*` — never hardcode tenant IDs,
  role names, or policy parameters inside rule bodies.

---

## Decision Logging

Every policy decision is logged to the SIEM pipeline:

| Field | Value |
|-------|-------|
| `decision` | `allow` / `deny` / `partial` |
| `policy` | Package name (e.g., `ordr.tenant_isolation`) |
| `rule` | Rule name that matched (or `default` if none matched) |
| `tenant_id` | From `input.jwt.tid`, never from client-supplied data |
| `request_id` | For correlation with application-layer audit |
| `latency_ms` | OPA evaluation time |
| `input_hash` | SHA-256 of input (not the input itself — PII/PHI safe) |

Never log the raw `input` document — it may contain PHI/PII. The SHA-256 hash
is sufficient for correlation and tamper detection without exposing content.

Decision logs are ingested into the audit chain (`packages/audit/src/merkle.ts`)
so policy-level decisions participate in the WORM Merkle tree and are preserved
under the 7-year retention policy.

---

## Compliance Mapping (Consolidated)

| Control | Policies Providing Coverage |
|---------|------------------------------|
| **HIPAA §164.312(a)(1)** Access control | `tenant-isolation`, `phi-access-control`, `agent-permissions` |
| **HIPAA §164.312(a)(2)(iv)** Encryption | `data-encryption` |
| **HIPAA §164.312(b)** Audit controls | `audit-completeness` |
| **HIPAA §164.502(b)** Minimum necessary | `phi-access-control` |
| **SOC 2 CC6.1** Logical access | `tenant-isolation`, `phi-access-control` |
| **SOC 2 CC6.3** Role-based authorization | `agent-permissions` |
| **SOC 2 CC6.6** Network / edge restriction | `api-security`, `network-policy` |
| **SOC 2 CC6.7** Data-at-rest confidentiality | `data-encryption` |
| **SOC 2 CC6.8** Malicious code prevention | `container-security` |
| **SOC 2 CC7.2** Monitoring / anomaly detection | `audit-completeness` |
| **ISO 27001 A.8.2.3** Handling classified assets | `phi-access-control` |
| **ISO 27001 A.9.4.1** Access restriction | `tenant-isolation` |
| **ISO 27001 A.10.1.1** Cryptographic controls | `data-encryption` |
| **ISO 27001 A.12.4.1** Logging | `audit-completeness` |
| **ISO 27001 A.12.5.1** Software on operational systems | `container-security` |
| **ISO 27001 A.13.1.3** Network segregation | `network-policy`, `api-security` |
| **ISO 27001 A.14.2.5** Secure system engineering | `container-security` |

---

## Roles & Responsibilities

| Role | Responsibility |
|------|----------------|
| **Security Engineering** | Authors policies, reviews changes, owns the threat models that justify each policy. |
| **Compliance** | Reviews compliance mapping, tracks evidence, signs off on audit exports. |
| **Platform Engineering** | Owns the OPA deployment, bundle distribution, performance tuning, CI integration. |
| **Incident Commander** | May authorize single-reviewer emergency changes with retroactive review. |
| **CTO** | Final authority on policy removals or compliance-mapping changes. |

---

## Related Documents

- [`security/threat-models/`](../threat-models/) — STRIDE models that justify policies.
- [`docs/runbooks/incident-response.md`](../../docs/runbooks/incident-response.md) — Emergency change procedure.
- [`docs/runbooks/business-continuity.md`](../../docs/runbooks/business-continuity.md) — Continuity posture.
- [`CLAUDE.md`](../../CLAUDE.md) — The ten mandatory development rules these policies encode.

---

## Revision History

| Date | Change | Author |
|------|--------|--------|
| 2026-04-18 | Initial governance doc (Phase 139) | Platform Engineering |
