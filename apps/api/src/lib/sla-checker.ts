/**
 * SLA Breach Checker — periodic background scanner for overdue interactions
 *
 * SOC2 CC7.2   — Monitoring: automated detection of SLA breach conditions.
 * ISO 27001 A.16.1.1 — Responsibilities for information security events.
 * HIPAA §164.308(a)(5)(ii)(C) — Log-in monitoring: track unanswered contacts.
 *
 * Logic:
 * - Every CHECK_INTERVAL_MS, scan for inbound message/call interactions that:
 *   (a) are older than BREACH_THRESHOLD_HOURS
 *   (b) have had no outbound response from the same tenant/customer
 *   (c) have not already generated an SLA notification
 * - For each breach found, insert a 'sla' severity='high' notification
 * - LIMIT 50 per run — prevents runaway inserts on first startup with old data
 *
 * Deduplication: notification metadata stores interaction_id; the NOT EXISTS
 * subquery prevents duplicate inserts across runs.
 *
 * SECURITY:
 * - No PHI written to notifications (Rule 6)
 * - Notification metadata uses IDs only — NEVER content
 * - Errors are logged but NEVER crash the server process
 */

import { sql } from 'drizzle-orm';
import type { OrdrDatabase } from '@ordr/db';
import { notifications } from '@ordr/db';

// ─── Configuration ────────────────────────────────────────────────

/** Hours without a response before an interaction is considered an SLA breach. */
const BREACH_THRESHOLD_HOURS = 4;

/** Only look back this many hours to limit re-processing on restart. */
const LOOKBACK_HOURS = 48;

/** Maximum breaches processed per run. Prevents insert storms on startup. */
const BATCH_LIMIT = 50;

/** Default check interval: 5 minutes. */
export const DEFAULT_CHECK_INTERVAL_MS = 5 * 60 * 1000;

// ─── Types ────────────────────────────────────────────────────────

interface BreachRow extends Record<string, unknown> {
  readonly id: string;
  readonly tenant_id: string;
  readonly customer_id: string;
  readonly channel: string;
  readonly created_at: Date;
}

// ─── SlaChecker ──────────────────────────────────────────────────

export class SlaChecker {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly db: OrdrDatabase) {}

  /**
   * Start the periodic SLA check loop.
   * Safe to call multiple times — ignores if already running.
   */
  start(intervalMs: number = DEFAULT_CHECK_INTERVAL_MS): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => {
      void this.check().catch((err: unknown) => {
        console.error('[ORDR:SLA] Check error:', err);
      });
    }, intervalMs);
    console.warn(
      `[ORDR:SLA] Checker started — threshold=${String(BREACH_THRESHOLD_HOURS)}h, interval=${String(intervalMs / 60_000)}min`,
    );
  }

  /** Stop the periodic loop. */
  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
      console.warn('[ORDR:SLA] Checker stopped');
    }
  }

  /**
   * Run one SLA check pass.
   * Finds breaches, inserts notifications, returns count of new breaches.
   * Safe to call manually for immediate checks or testing.
   */
  async check(): Promise<number> {
    const breaches = await this.findBreaches();
    if (breaches.length === 0) return 0;

    await this.insertNotifications(breaches);
    console.warn(`[ORDR:SLA] ${String(breaches.length)} breach(es) detected and notified`);
    return breaches.length;
  }

  // ── Private ────────────────────────────────────────────────────

  private async findBreaches(): Promise<BreachRow[]> {
    // Raw SQL: NOT EXISTS subqueries are cleaner than Drizzle's relational API
    // for this multi-table negation pattern.
    //
    // Rule 4 — no user input in this query; all values are hardcoded constants.
    const result = await this.db.execute<BreachRow>(sql`
      SELECT
        i.id,
        i.tenant_id,
        i.customer_id,
        i.channel,
        i.created_at
      FROM interactions i
      WHERE i.direction = 'inbound'
        AND i.type IN ('message', 'call')
        AND i.created_at < NOW() - INTERVAL '${sql.raw(String(BREACH_THRESHOLD_HOURS))} hours'
        AND i.created_at > NOW() - INTERVAL '${sql.raw(String(LOOKBACK_HOURS))} hours'
        AND NOT EXISTS (
          SELECT 1
          FROM interactions r
          WHERE r.tenant_id = i.tenant_id
            AND r.customer_id = i.customer_id
            AND r.direction = 'outbound'
            AND r.created_at > i.created_at
        )
        AND NOT EXISTS (
          SELECT 1
          FROM notifications n
          WHERE n.tenant_id = i.tenant_id
            AND n.type = 'sla'
            AND n.metadata->>'interaction_id' = i.id::text
        )
      LIMIT ${sql.raw(String(BATCH_LIMIT))}
    `);

    return Array.from(result);
  }

  private async insertNotifications(breaches: BreachRow[]): Promise<void> {
    const now = new Date();

    for (const breach of breaches) {
      const breachHours =
        Math.round(((now.getTime() - breach.created_at.getTime()) / 3_600_000) * 10) / 10;

      await this.db
        .insert(notifications)
        .values({
          tenantId: breach.tenant_id,
          type: 'sla',
          severity: 'high',
          title: `SLA breach: ${String(Math.floor(breachHours))}h without response`,
          description: `Inbound ${breach.channel} interaction has not received a response in ${String(breachHours)} hours (SLA: ${String(BREACH_THRESHOLD_HOURS)}h).`,
          actionLabel: 'View Customer',
          actionRoute: `/customers/${breach.customer_id}`,
          metadata: {
            interaction_id: breach.id,
            customer_id: breach.customer_id,
            channel: breach.channel,
            breach_hours: String(breachHours),
          },
        })
        .onConflictDoNothing(); // belt-and-suspenders dedup if race condition
    }
  }
}
