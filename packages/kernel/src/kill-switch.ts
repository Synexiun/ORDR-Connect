/**
 * KillSwitchReceiver — Amputation mechanism for limbs.
 *
 * When Core activates the kill switch for a limb, all operations
 * must immediately cease. The kill switch is irreversible within a
 * process lifetime — recovery requires a restart with a fresh
 * identity issued by Core.
 *
 * TypeScript port of synex_kernel/health/kill_switch.py
 *
 * RULE 9 (Agent Safety): Kill switch is mandatory for AI agent safety.
 * CLAUDE.md: "Kill switch: Immediate agent termination capability at
 * tenant and global level."
 */

export class KillSwitchActivatedError extends Error {
  constructor(limbId: string, reason: string) {
    super(`Limb ${limbId} has been amputated: ${reason}`);
    this.name = 'KillSwitchActivatedError';
  }
}

export type KillSwitchStatus = 'alive' | 'dead';

export class KillSwitchReceiver {
  private _activated = false;
  private _activatedAt: Date | null = null;
  private _reason: string | null = null;

  constructor(private readonly limbId: string) {}

  get isActivated(): boolean {
    return this._activated;
  }

  get activatedAt(): Date | null {
    return this._activatedAt;
  }

  get reason(): string | null {
    return this._reason;
  }

  get status(): KillSwitchStatus {
    return this._activated ? 'dead' : 'alive';
  }

  /**
   * Activate the kill switch. Irreversible within this process.
   *
   * Called when Core sends a DEAD status or identity command with
   * action="revoke" for this limb.
   */
  activate(reason: string = 'kill switch activated by Core'): void {
    this._activated = true;
    this._activatedAt = new Date();
    this._reason = reason;
  }

  /**
   * Assert the kill switch is not active.
   * Call this before any significant operation.
   *
   * @throws KillSwitchActivatedError if activated
   */
  check(): void {
    if (this._activated) {
      throw new KillSwitchActivatedError(this.limbId, this._reason ?? 'unknown reason');
    }
  }
}
