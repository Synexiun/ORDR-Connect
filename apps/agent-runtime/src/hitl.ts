/**
 * Human-in-the-loop queue — review queue for low-confidence agent decisions
 *
 * SECURITY (CLAUDE.md Rule 9):
 * - Confidence < 0.7 MUST route to HITL — agent cannot auto-execute
 * - Financial actions ALWAYS require HITL approval
 * - PHI access ALWAYS requires HITL approval
 * - Mass communications ALWAYS require HITL approval
 * - All approvals/rejections are audit-logged
 *
 * COMPLIANCE:
 * - Every HITL action is recorded with approver identity and timestamp
 * - Rejected decisions include the rejection reason for audit trail
 * - In-memory for MVP — production uses database-backed persistent queue
 */

import { randomUUID } from 'node:crypto';
import type { AgentDecision, AgentContext, HitlItem } from './types.js';

// ─── HitlQueue ──────────────────────────────────────────────────

export class HitlQueue {
  private readonly items: Map<string, HitlItem> = new Map();

  /**
   * Add a low-confidence or approval-required decision to the review queue.
   *
   * @returns The queue item ID for tracking
   */
  enqueue(
    sessionId: string,
    decision: AgentDecision,
    context: AgentContext,
  ): string {
    const id = randomUUID();

    const item: HitlItem = {
      id,
      sessionId,
      tenantId: context.tenantId,
      decision,
      context: {
        sessionId: context.sessionId,
        tenantId: context.tenantId,
        customerId: context.customerId,
        agentRole: context.agentRole,
      },
      createdAt: new Date(),
      status: 'pending',
      reviewedBy: undefined,
      reviewedAt: undefined,
      rejectionReason: undefined,
    };

    this.items.set(id, item);
    return id;
  }

  /**
   * Approve a pending HITL item.
   * Returns the original decision so the agent can execute it.
   *
   * @throws Error if item not found or not in pending state
   */
  approve(itemId: string, approverUserId: string): AgentDecision {
    const item = this.items.get(itemId);

    if (item === undefined) {
      throw new Error(`HITL item ${itemId} not found`);
    }

    if (item.status !== 'pending') {
      throw new Error(`HITL item ${itemId} is not pending (status: ${item.status})`);
    }

    const approved: HitlItem = {
      ...item,
      status: 'approved',
      reviewedBy: approverUserId,
      reviewedAt: new Date(),
    };

    this.items.set(itemId, approved);
    return item.decision;
  }

  /**
   * Reject a pending HITL item with a reason.
   *
   * @throws Error if item not found or not in pending state
   */
  reject(itemId: string, approverUserId: string, reason: string): void {
    const item = this.items.get(itemId);

    if (item === undefined) {
      throw new Error(`HITL item ${itemId} not found`);
    }

    if (item.status !== 'pending') {
      throw new Error(`HITL item ${itemId} is not pending (status: ${item.status})`);
    }

    const rejected: HitlItem = {
      ...item,
      status: 'rejected',
      reviewedBy: approverUserId,
      reviewedAt: new Date(),
      rejectionReason: reason,
    };

    this.items.set(itemId, rejected);
  }

  /**
   * Get all pending items for a tenant.
   * Returns items sorted by creation time (oldest first).
   */
  getPending(tenantId: string): HitlItem[] {
    const pending: HitlItem[] = [];

    for (const item of this.items.values()) {
      if (item.tenantId === tenantId && item.status === 'pending') {
        pending.push(item);
      }
    }

    return pending.sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    );
  }

  /**
   * Get a specific HITL item by ID.
   */
  getItem(itemId: string): HitlItem | undefined {
    return this.items.get(itemId);
  }

  /**
   * Get the total count of items in the queue.
   */
  get size(): number {
    return this.items.size;
  }

  /**
   * Get count of pending items for a tenant.
   */
  getPendingCount(tenantId: string): number {
    let count = 0;
    for (const item of this.items.values()) {
      if (item.tenantId === tenantId && item.status === 'pending') {
        count++;
      }
    }
    return count;
  }
}
