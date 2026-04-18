# Runbook — CobrowseSseConnectionsHigh (P3)

## Classification

| Field | Value |
|-------|-------|
| Alert | `CobrowseSseConnectionsHigh` |
| Severity | P3 — Low (1 week response) |
| Source | `infrastructure/kubernetes/monitoring/prometheus-rules.yaml` |
| Metric | `cobrowse_sse_connections_active` |
| Owner | Platform Engineering |
| Compliance | SOC 2 CC7.1 |

---

## What Fired

A single tenant has held **more than 50 active co-browse SSE connections for 30 minutes**. Legitimate usage is 2 subscribers per live session (admin + customer), so this alert triggers at roughly 25× the expected headroom even under high concurrent session load.

## Why It Matters

This is a capacity / hygiene signal, not a security alert on its own — but the gauge only climbs via three mechanisms, and two of them are worth investigating:

1. **Many concurrent sessions.** Large tenants during a peak event could legitimately approach this floor.
2. **Stuck clients.** Decrement happens in a `finally` block; if the Node process crashes or a connection hangs in kernel buffers, the gauge can drift high.
3. **Slow leak.** A subtle bug where `subscribeSignals` paths skip `unsubscribe()` will push the gauge up over days.

---

## Triage (first hour, no urgency)

1. **Open the Co-browse dashboard** (`ordr-cobrowse`). Look at "Active SSE Connections (by tenant)" and "Signals per Minute (by type)".

2. **Sanity-check against sessions.** Query the audit store:

   ```sql
   SELECT count(*) AS active_sessions
   FROM audit_events
   WHERE tenant_id = :tenant_id
     AND action_type = 'cobrowse.session_started'
     AND created_at > now() - interval '2 hours'
     AND session_id NOT IN (
       SELECT session_id FROM audit_events
       WHERE action_type IN ('cobrowse.session_ended', 'cobrowse.session_rejected')
     );
   ```

   Expected active subscribers ≈ `active_sessions × 2` (with a few in reconnect overlap). If `cobrowse_sse_connections_active >> 2 × active_sessions`, the gauge is drifting.

3. **Check signal throughput.** "Signals per Minute (by type)" panel. If signals are flowing through the held connections, they are live (case 1). If connections are idle — no signals — they're stuck (case 2/3).

---

## Remediation

### A — Genuine peak load

1. No action. Monitor through the peak. If this becomes routine, raise the alert threshold (currently `> 50`) in `prometheus-rules.yaml` and document the new baseline.

### B — Stuck / idle clients

1. The Node API process holds the SSE streams. Restart the affected pod(s):
   ```bash
   kubectl -n ordr-system rollout restart deployment/ordr-api
   ```
   Rolling restart will drop all SSE streams; clients will reconnect, stuck ones will not. Gauge drops and stays down if the cause was stuck clients.
2. If the gauge climbs back quickly after restart, escalate to case C.

### C — Subscriber leak

1. Grep for all `subscribeSignals(` call sites. Every one must have a matching `unsubscribe()` in a `finally` or equivalent cleanup path.
   ```
   apps/api/src/routes/cobrowse.ts
   ```
2. Reproduce locally under load (the integration test in `apps/api/src/__tests__/` can be adapted by looping connect→disconnect and asserting the counter returns to zero).
3. Patch, ship, confirm the gauge returns to expected baseline.

---

## Escalation

| Condition | Escalate to |
|-----------|-------------|
| Gauge still elevated after rolling restart | Platform lead |
| `CobrowseSignalRateLimitSustained` also firing for same tenant | Follow the P2 runbook first; this alert is secondary |
| Suspected leak in code that was recently shipped | Revert the PR; track leak in a root-cause ticket |

---

## Post-Incident

- If case A, log the new peak in capacity planning notes.
- If case C, add a unit test that asserts `cobrowse_sse_connections_active` returns to zero after disconnect — prevents regression.

## References

- Alert definition: `infrastructure/kubernetes/monitoring/prometheus-rules.yaml`
- Signal route: `apps/api/src/routes/cobrowse.ts`
- Metric: `cobrowse_sse_connections_active` (`packages/observability/src/metrics.ts`)
- Sibling alert: `docs/runbooks/alerts/cobrowse-rate-limit.md`
