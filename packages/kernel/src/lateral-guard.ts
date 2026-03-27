/**
 * LateralGuard — Enforces the Synexiun Data Diode Law.
 *
 * No limb may communicate directly with another limb.
 * All messages must flow through Core: upward (limb→Core) or
 * downward (Core→limb) only. Lateral (limb→limb) traffic is
 * architecturally blocked.
 *
 * TypeScript port of synex_kernel/diode/lateral_guard.py
 */

import { CORE_ID } from './constants.js';

export class LateralCommunicationError extends Error {
  public readonly source: string;
  public readonly target: string;

  constructor(source: string, target: string) {
    super(`Lateral communication blocked: ${source} → ${target}`);
    this.name = 'LateralCommunicationError';
    this.source = source;
    this.target = target;
  }
}

export interface LateralViolation {
  readonly source: string;
  readonly target: string;
  readonly blockedAt: Date;
}

export class LateralGuard {
  private readonly _violations: LateralViolation[] = [];

  constructor(
    private readonly ownLimbId: string,
    private readonly coreId: string = CORE_ID,
  ) {}

  /**
   * Assert that communicating with `targetId` is allowed.
   *
   * Allowed targets:
   * - own limb ID (self-communication is fine)
   * - Core (upward diode)
   *
   * Throws LateralCommunicationError for all other targets.
   */
  check(targetId: string): void {
    if (targetId === this.ownLimbId) return;
    if (targetId === this.coreId) return;

    const violation: LateralViolation = {
      source: this.ownLimbId,
      target: targetId,
      blockedAt: new Date(),
    };
    this._violations.push(violation);

    throw new LateralCommunicationError(this.ownLimbId, targetId);
  }

  /** All recorded lateral violations (for audit / telemetry). */
  get violations(): readonly LateralViolation[] {
    return this._violations;
  }
}
