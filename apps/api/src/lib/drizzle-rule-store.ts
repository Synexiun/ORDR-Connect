/**
 * DrizzleRuleStore — PostgreSQL-backed RuleStore for the NBA Decision Engine.
 *
 * Implements the RuleStore interface from @ordr/decision-engine using Drizzle ORM.
 * Built-in rules are always active for every tenant; per-tenant DB rules are
 * merged on top (DB rules override built-ins by ID).
 *
 * SOC2 CC6.1 — All rule reads are tenant-scoped (tenantId filter enforced).
 * ISO 27001 A.12.4.1 — updatedAt stamp on every mutation.
 * HIPAA §164.312(b) — Rules contain no PHI (conditions reference field paths only).
 *
 * SECURITY:
 * - tenantId is ALWAYS applied to every query — no cross-tenant reads.
 * - JSONB columns (conditions, action) are cast, not validated here —
 *   schema validation happens at the HTTP layer before createRule/updateRule.
 */

import { eq, and, desc } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@ordr/db';
import type { RuleStore } from '@ordr/decision-engine';
import type { RuleDefinition, RuleCondition, RuleAction } from '@ordr/decision-engine';
import { copyBuiltinRulesForTenant } from '@ordr/decision-engine';

type Db = PostgresJsDatabase<typeof schema>;

// ─── Row mapper ──────────────────────────────────────────────────

function rowToRuleDefinition(row: typeof schema.decisionRules.$inferSelect): RuleDefinition {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    description: row.description,
    priority: row.priority,
    conditions: row.conditions as readonly RuleCondition[],
    action: row.action as RuleAction,
    regulation: row.regulation ?? undefined,
    enabled: row.enabled,
    terminal: row.terminal,
  };
}

// ─── DrizzleRuleStore ────────────────────────────────────────────

export class DrizzleRuleStore implements RuleStore {
  constructor(private readonly db: Db) {}

  /**
   * Return all active rules for a tenant.
   *
   * Built-in rules are always included. If a DB rule shares an ID with a
   * built-in, the DB rule takes precedence (tenant customisation).
   * Rules are returned sorted by priority descending (highest first).
   */
  async getRules(tenantId: string): Promise<readonly RuleDefinition[]> {
    const rows = await this.db
      .select()
      .from(schema.decisionRules)
      .where(
        and(eq(schema.decisionRules.tenantId, tenantId), eq(schema.decisionRules.enabled, true)),
      )
      .orderBy(desc(schema.decisionRules.priority));

    const dbRules = rows.map(rowToRuleDefinition);

    // Merge: built-ins first, DB rules override by ID
    const combined = new Map<string, RuleDefinition>();
    for (const r of copyBuiltinRulesForTenant(tenantId)) combined.set(r.id, r);
    for (const r of dbRules) combined.set(r.id, r);

    return [...combined.values()].sort((a, b) => b.priority - a.priority);
  }

  /**
   * Retrieve a single rule by ID. Checks DB first, then built-ins.
   * Returns undefined if the rule does not belong to the given tenant.
   */
  async getRule(id: string, tenantId: string): Promise<RuleDefinition | undefined> {
    const rows = await this.db
      .select()
      .from(schema.decisionRules)
      .where(and(eq(schema.decisionRules.id, id), eq(schema.decisionRules.tenantId, tenantId)))
      .limit(1);

    if (rows[0] !== undefined) return rowToRuleDefinition(rows[0]);

    // Fall back to built-ins
    return copyBuiltinRulesForTenant(tenantId).find((r) => r.id === id);
  }

  async createRule(rule: RuleDefinition): Promise<void> {
    await this.db.insert(schema.decisionRules).values({
      id: rule.id,
      tenantId: rule.tenantId,
      name: rule.name,
      description: rule.description,
      priority: rule.priority,
      conditions: rule.conditions as unknown,
      action: rule.action as unknown,
      regulation: rule.regulation ?? null,
      enabled: rule.enabled,
      terminal: rule.terminal,
    });
  }

  async updateRule(rule: RuleDefinition): Promise<void> {
    await this.db
      .update(schema.decisionRules)
      .set({
        name: rule.name,
        description: rule.description,
        priority: rule.priority,
        conditions: rule.conditions as unknown,
        action: rule.action as unknown,
        regulation: rule.regulation ?? null,
        enabled: rule.enabled,
        terminal: rule.terminal,
        updatedAt: new Date(),
      })
      .where(
        and(eq(schema.decisionRules.id, rule.id), eq(schema.decisionRules.tenantId, rule.tenantId)),
      );
  }

  async deleteRule(id: string, tenantId: string): Promise<void> {
    await this.db
      .delete(schema.decisionRules)
      .where(and(eq(schema.decisionRules.id, id), eq(schema.decisionRules.tenantId, tenantId)));
  }
}
