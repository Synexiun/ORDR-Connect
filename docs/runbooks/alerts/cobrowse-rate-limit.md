# Runbook — CobrowseSignalRateLimitSustained (P2)

## Classification

| Field | Value |
|-------|-------|
| Alert | `CobrowseSignalRateLimitSustained` |
| Severity | P2 — Medium (24h response) |
| Source | `infrastructure/kubernetes/monitoring/prometheus-rules.yaml` |
| Metric | `cobrowse_signals_rate_limited_total` |
| Owner | Platform Engineering |
| Compliance | SOC 2 CC7.1 · HIPAA §164.312(b) |

---

## What Fired

Rate of rejected co-browse SSE subscriptions has exceeded **0.05/s for 10 minutes** for one or more tenants. Each rejection also produces a WORM audit event of type `cobrowse.signaling_rate_limited`.

The signaling server enforces `MAX_SSE_CONNECTIONS_PER_SESSION = 4` (see `apps/api/src/routes/cobrowse.ts`). A legitimate co-browse session has exactly 2 subscribers (admin + customer); the cap leaves headroom for brief reconnect overlap. Sustained firing means a single session is being subscribed to by far more clients than normal.

## Why It Matters

Three plausible root causes, ordered from most to least benign:

1. **Client reconnect loop** — the web dashboard or extension is in a backoff-free retry cycle after a transient network blip.
2. **Stuck subscriber** — an old tab/window never ran its SSE cleanup (`controller.abort()`). Gauge `cobrowse_sse_connections_active` will be elevated but stable.
3. **Abuse / probe** — an authenticated adversary attempting to enumerate session IDs or flood a session.

All three also fill the audit log with `cobrowse.signaling_rate_limited` events, which is noise in compliance reporting and real cost in storage.

---

## Triage (first 10 minutes)

1. **Open the Co-browse dashboard** (`ordr-cobrowse`, uid: `ordr-cobrowse`). Confirm the "Rate-Limited Subscriptions" panel shows the same tenant(s) the alert labelled.

2. **Get the tenant_id and reason** from the firing alert labels. `reason` today is always `sse_connection_cap` — if you see any other value, stop and escalate: it means new code added a new rate-limit path and this runbook is out of date.

3. **Correlate with audit events.** Query the audit store:

   ```sql
   SELECT session_id, actor_id, created_at, details
   FROM audit_events
   WHERE tenant_id = :tenant_id
     AND action_type = 'cobrowse.signaling_rate_limited'
     AND created_at > now() - interval '15 minutes'
   ORDER BY created_at DESC;
   ```

   Cluster by `session_id`. Single session dominant → reconnect loop or targeted probe. Many sessions → tenant-wide issue.

4. **Check the active-connection gauge.** Dashboard panel "Active SSE Connections (by tenant)". If the gauge for this tenant is also elevated (>10 per session on average), stuck subscribers are likely. If the gauge is normal but rejections are high, new connects are cycling faster than they should.

---

## Remediation

### A — Reconnect loop (most common)

Most likely if the rate-limit counter spikes but the active gauge stays low.

1. Inspect the offending client. If it's the web dashboard, check browser dev tools for SSE retries. If it's the MV3 extension, check `chrome://extensions` service-worker console.
2. The fetch-based SSE reader in `apps/web/src/lib/cobrowse-api.ts` intentionally does not auto-reconnect (caller responsibility). A caller that loops on abort should be patched to apply exponential backoff. File a bug and ship the fix.
3. No infra change required; once the client stops, the alert clears after 10m.

### B — Stuck subscriber

1. The session store's SSE counter is decremented in a `finally` block on disconnect. If clients never disconnect cleanly (e.g. browser crash), the count stays high.
2. **Immediate**: end the affected sessions via the admin API or `POST /v1/cobrowse/sessions/:id/end`. This force-closes all subscribers.
3. **Follow-up**: consider adding a server-side idle timeout on SSE connections (currently only the 2-hour session expiry caps the loop).

### C — Abuse / probe

1. If `actor_id` in the audit events is consistent and **not** an admin or the session's owning user, treat as an access-control incident.
2. Rotate that principal's API token / force re-auth (see `docs/runbooks/incident-response.md` Procedure 3 — Containment).
3. Escalate to **P1** if the probe crosses tenants (the alert is per-tenant, so multiple simultaneous firings across tenants is a red flag).

---

## Escalation

| Condition | Escalate to |
|-----------|-------------|
| Multiple tenants firing simultaneously | P1 — Security on-call |
| Non-admin, non-owner `actor_id` | P1 — Security on-call |
| Audit chain break in parallel (`AuditChainBroken` also firing) | P0 — Incident Response |
| Cannot identify root cause within 2 hours | Platform lead + incident channel |

---

## Post-Incident

- Log the resolution category (A/B/C above) in the incident ticket.
- If a client bug was patched, add a regression test in `apps/web/src/__tests__/` exercising the reconnect guard.
- If cap needs tuning, coordinate with Security — changing `MAX_SSE_CONNECTIONS_PER_SESSION` is a defence-in-depth knob and should be reviewed.

## References

- Alert definition: `infrastructure/kubernetes/monitoring/prometheus-rules.yaml`
- Signal route: `apps/api/src/routes/cobrowse.ts`
- Audit event type: `cobrowse.signaling_rate_limited` (defined `packages/audit/src/types.ts`)
- Metric: `cobrowse_signals_rate_limited_total` (`packages/observability/src/metrics.ts`)
