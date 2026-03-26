# ORDR-Connect — Disaster Recovery Runbook

## Classification

| Field | Value |
|-------|-------|
| Severity | P0 — Critical |
| Compliance | SOC2 A1.2, ISO 27001 A.17, HIPAA 164.308(a)(7) |
| Last tested | _YYYY-MM-DD_ |
| Owner | Platform Engineering |
| Reviewers | Security, Compliance |

---

## Recovery Objectives

| Metric | Target | Mechanism |
|--------|--------|-----------|
| **RTO — Single-AZ failure** | < 60 seconds | Multi-AZ automatic failover |
| **RTO — Full region failure** | < 300 seconds | Cross-region replica promotion |
| **RPO — RDS (Multi-AZ)** | 0 (synchronous) | Synchronous replication to standby |
| **RPO — Cross-region backup** | < 1 hour | Automated snapshot replication |
| **RPO — Audit logs (S3 WORM)** | 0 | Real-time replication to S3 Object Lock |
| **RPO — Kafka events** | < 5 minutes | Multi-AZ MSK with 3x replication |

---

## Procedure 1 — RDS Multi-AZ Failover (Single-AZ failure)

**Trigger:** AZ outage, primary instance failure, or planned maintenance.

1. **Detection** — CloudWatch alarm `ordr-rds-*` fires; PagerDuty alert.
2. **Automatic failover** — RDS promotes standby (< 60s, no manual action).
3. **Verify** — Check endpoint connectivity:
   ```bash
   psql "$DATABASE_URL" -c "SELECT 1;"
   ```
4. **Validate data** — Run audit chain integrity check:
   ```bash
   pnpm --filter @ordr/db run migrate status
   ```
5. **Monitor** — Watch error rates in Grafana for 30 minutes post-failover.
6. **Post-incident** — Log failover in incident tracker. No data loss expected.

---

## Procedure 2 — RDS Point-in-Time Recovery

**Trigger:** Data corruption, accidental deletion, or application-level error.

1. **Assess** — Identify the timestamp BEFORE the corruption event.
2. **Create recovery instance**:
   ```bash
   aws rds restore-db-instance-to-point-in-time \
     --source-db-instance-identifier ordr-connect-production \
     --target-db-instance-identifier ordr-connect-pitr-$(date +%s) \
     --restore-time "YYYY-MM-DDTHH:MM:SSZ" \
     --db-instance-class db.r6g.xlarge \
     --vpc-security-group-ids $SECURITY_GROUP_ID \
     --db-subnet-group-name ordr-connect-production \
     --no-publicly-accessible
   ```
3. **Validate recovered data** — Connect to the recovery instance and verify:
   ```bash
   psql -h <recovery-endpoint> -U ordr_admin -d ordr_connect \
     -c "SELECT count(*) FROM audit_logs;"
   ```
4. **Promote or extract** — Either:
   - a) Rename recovery instance to replace primary, OR
   - b) Export specific tables/rows and insert into primary.
5. **Verify audit chain** — Run Merkle tree verification on restored data.
6. **Destroy recovery instance** when confirmed.

---

## Procedure 3 — Full Region Disaster Recovery

**Trigger:** Complete AWS region outage.

1. **Declare DR** — Incident commander confirms region is unrecoverable.
2. **Promote cross-region backup**:
   ```bash
   # List available replicated snapshots in DR region
   aws rds describe-db-snapshots \
     --region us-west-2 \
     --db-instance-identifier ordr-connect-production \
     --snapshot-type automated

   # Restore from latest snapshot
   aws rds restore-db-instance-from-db-snapshot \
     --region us-west-2 \
     --db-instance-identifier ordr-connect-dr \
     --db-snapshot-identifier <latest-snapshot-id> \
     --db-instance-class db.r6g.xlarge \
     --vpc-security-group-ids $DR_SECURITY_GROUP_ID \
     --db-subnet-group-name ordr-connect-dr \
     --no-publicly-accessible
   ```
3. **Update DNS** — Switch Route53 failover records to DR region.
4. **Deploy application** — Trigger DR deployment pipeline:
   ```bash
   gh workflow run deploy-dr.yml -f region=us-west-2
   ```
5. **Kafka recovery** — MSK in DR region activates. Consumers resume from last committed offset.
6. **Verify** — Full smoke test suite against DR environment.
7. **Notify** — Alert all tenants of potential RPO gap (up to 1 hour of data).

---

## Procedure 4 — Audit Log Recovery

**Trigger:** Audit chain break detected, or audit table corruption.

1. **DO NOT modify audit tables** — WORM triggers prevent this, but verify:
   ```sql
   SELECT tgname, tgenabled FROM pg_trigger
   WHERE tgrelid = 'audit_logs'::regclass;
   ```
2. **Restore from S3 WORM** — Audit logs replicated to S3 Object Lock:
   ```bash
   aws s3api list-objects-v2 \
     --bucket ordr-connect-audit-logs-production-$ACCOUNT_ID \
     --prefix "tenant/$TENANT_ID/"
   ```
3. **Verify chain integrity** — Recompute hash chain from S3 backup:
   ```bash
   pnpm --filter @ordr/audit run verify-chain --tenant-id $TENANT_ID
   ```
4. **Re-insert if needed** — Only append missing records (never modify existing).

---

## Backup Verification (Monthly)

**Schedule:** First Monday of every month.

1. **Create test restoration** from latest automated snapshot.
2. **Run migration status check** — all migrations must show as applied.
3. **Run audit chain verification** — zero breaks.
4. **Run application smoke tests** against restored instance.
5. **Measure RTO** — time from snapshot selection to healthy application.
6. **Document results** in compliance tracker.
7. **Destroy test restoration** instance.

---

## Escalation Chain

| Level | Contact | Response Time |
|-------|---------|---------------|
| L1 — On-call engineer | PagerDuty rotation | 5 minutes |
| L2 — Platform lead | Direct page | 15 minutes |
| L3 — CTO / Incident commander | Phone escalation | 30 minutes |
| L4 — AWS TAM (if infrastructure) | Support case (Enterprise) | Per SLA |

---

## Compliance Notes

- **HIPAA §164.308(a)(7)(ii)(A):** Data backup plan — automated daily, 35-day retention.
- **HIPAA §164.308(a)(7)(ii)(B):** Disaster recovery plan — this document.
- **HIPAA §164.308(a)(7)(ii)(D):** Testing and revision — monthly verification.
- **SOC2 A1.2:** Recovery objectives defined and tested.
- **ISO 27001 A.17.1.1:** Information security continuity planned.
- **ISO 27001 A.17.1.3:** Verify, review, evaluate continuity controls.
