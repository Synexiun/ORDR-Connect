# Runbook — ShadowModelErrorRateHigh (P3)

## Classification

| Field | Value |
|-------|-------|
| Alert | `ShadowModelErrorRateHigh` |
| Severity | P3 — Low (1 week response) |
| Source | `infrastructure/kubernetes/monitoring/prometheus-rules.yaml` |
| Metric | `shadow_comparisons_total{status=~"error\|missing_model"}` |
| Owner | Platform Engineering · Data Science (advisory) |
| Compliance | SOC 2 CC7.1 · Rule 9 (AI governance) |

---

## What Fired

A shadow model has had > 5% of its comparisons return `error` or `missing_model` status for 30 minutes. **Primary decisions are not affected** — `ShadowScorer` explicitly isolates shadow failures from the primary scoring path (`packages/decision-engine/src/shadow-scorer.ts`). This alert is about the *quality of the comparison corpus* being collected, not about production decisions.

If you're here because promotion of a candidate model is being evaluated, pause the evaluation until this clears.

## Why It Matters

A shadow erroring at >5% means:

- **Divergence metrics are unreliable.** The P50/P95/P99 histograms only reflect the comparisons that succeeded. If 20% of comparisons error and those errors correlate with specific customer types (e.g., the candidate crashes on zero-feature inputs), the healthy-looking divergence is misleading.
- **Promotion readiness cannot be assessed.** Our rule of thumb ("P95 < 0.1, P99 < 0.2 sustained") assumes a roughly unbiased error distribution, which requires low total error volume.
- **The candidate bundle may be broken.** A missing-model sentinel specifically indicates the candidate bundle didn't register one of the model names the primary knows about.

---

## Triage (first day, no urgency)

1. **Open the Shadow Models dashboard** (`ordr-shadow-models`). The "Shadow Errors" panel shows the error breakdown by shadow_name and status.

2. **Distinguish `error` vs `missing_model`.** They imply very different root causes:

   | Status | Meaning | Typical Cause |
   |--------|---------|---------------|
   | `error` | Shadow's `score()` threw or returned `Result` failure | Bad feature input handling, NaN propagation, model weight file corrupted |
   | `missing_model` | Shadow scorer doesn't register the model name primary scored | Candidate bundle is stale — new model added to primary, candidate not rebuilt |

3. **Check which models are affected.** Query (via Prometheus UI or Grafana Explore):
   ```
   sum(increase(shadow_comparisons_total{status=~"error|missing_model"}[1h])) by (model_name, shadow_name, status)
   ```
   If a single `model_name` dominates, the candidate bundle is missing/miscompiled that model. If multiple do, the candidate has a broader issue.

---

## Remediation

### A — `missing_model` dominant

1. The candidate bundle is out of date with primary. Rebuild it from the current training pipeline and reload via `ML_BUNDLE_PATH`:
   ```bash
   # From data-science tooling — exact command is environment-specific.
   # The bundle loader hot-swaps without process restart (Phase 143).
   ```
2. Verify by watching `shadow_comparisons_total{status="missing_model"}` — rate should drop to zero within 5 minutes of the new bundle loading.

### B — `error` dominant, single model

1. One model in the candidate is broken. Capture a representative failing input — enable the passthrough sink (SIEM forwarder) momentarily if not already on, or log the shadow error message to structured logs.
2. Hand off to Data Science with the failing feature vector and the exception message. They fix the model code and re-ship a bundle.

### C — `error` dominant across multiple models

1. Most likely a regression in the shared candidate scoring path (feature assembler, preprocessing, runtime, bundle loader), not a per-model bug.
2. Roll back to the previous candidate bundle if possible. The bundle loader at `ML_BUNDLE_PATH` supports atomic swap — a rollback is just pointing at the prior bundle path and triggering reload.
3. Root-cause from logs + recent decision-engine commits.

---

## Escalation

| Condition | Escalate to |
|-----------|-------------|
| Primary model also erroring (`MLScorerErrorRate` alert, if exists) | **P1** — this would affect production decisions |
| Error rate > 50% for any shadow | Data Science on-call; bundle is likely entirely broken |
| Agreement/divergence classification collapsing to error across all shadows | Likely infra issue (observability pipeline) — check MetricsRegistry exposure |

**Never** escalate based on this alert alone to stop production traffic. Shadows do not influence primary decisions; primary decision-making is fine even if every shadow is erroring.

---

## Post-Incident

- If a bundle rebuild was needed, document the trigger in the bundle release notes (the Phase 143 SHA-256-signed bundle format includes a changelog field).
- If a shadow error was customer-type-dependent, add a synthetic test case covering that input shape to the decision-engine test suite so the regression can't repeat.
- If root cause was candidate-side and fixed quickly, consider whether a pre-shadow smoke test in CI (score 50 synthetic contexts, require zero errors) would have caught it. If yes, add it.

## References

- Alert definition: `infrastructure/kubernetes/monitoring/prometheus-rules.yaml`
- Shadow harness: `packages/decision-engine/src/shadow-scorer.ts`
- Metrics sink: `packages/decision-engine/src/prometheus-shadow-sink.ts`
- Bundle hot-swap loader (rollback target): `packages/decision-engine/src/ml-bundle.ts`
- Dashboard: `infrastructure/kubernetes/monitoring/dashboards/shadow-models.json` (uid `ordr-shadow-models`)
