/**
 * IdentityCommandReceiver — Polls Core for downward IdentityCommand directives.
 *
 * Mirrors the upward-write / downward-pull architecture established by
 * BudgetAllocationReceiver. Core issues kill-switch (`revoke`) or key-rotation
 * (`rotate`) commands via a dedicated endpoint; the limb polls it on a 15-second
 * cadence so termination decisions propagate quickly even if heartbeats are
 * delayed or queued.
 *
 * TypeScript port of synex_kernel/identity/command_receiver.py
 *
 * Wire contract:
 *   Request:  GET {coreUrl}/limbs/{limbId}/commands/identity/pending
 *   Response 200: IdentityCommand { action: 'revoke' | 'rotate', limb_id, reason }
 *   Response 204: no pending command — normal steady-state
 *   Response 4xx/5xx: logged, retried on next tick
 *
 * Effects:
 *   - action='revoke': calls killSwitch.activate(reason). Irreversible until
 *     process restart. Stop is invoked by the caller (Limb.terminate).
 *   - action='rotate': emits structured log for now; full rotation is a
 *     separate protocol that requires regenerating identity + re-registering.
 *
 * Polls more frequently than BudgetAllocationReceiver because kill-switch
 * propagation is safety-critical — a rogue limb must terminate ASAP.
 *
 * RULE 9 (Agent Safety): "Kill switch: Immediate agent termination capability
 *                         at tenant and global level."
 */

import { IDENTITY_COMMAND_POLL_INTERVAL_MS } from './constants.js';
import type { LimbIdentity } from './identity.js';
import type { KillSwitchReceiver } from './kill-switch.js';
import type { IdentityCommand } from './types.js';

export interface IdentityCommandReceiverOptions {
  /** Poll cadence in milliseconds. Default: IDENTITY_COMMAND_POLL_INTERVAL_MS (15s). */
  intervalMs?: number;
  /** Request timeout in milliseconds. Default: 10_000. */
  timeoutMs?: number;
}

export class IdentityCommandReceiver {
  private _running = false;
  private _timer: ReturnType<typeof setTimeout> | null = null;
  private _lastPollAt: Date | null = null;
  private _lastCommand: IdentityCommand | null = null;
  private _lastError: Error | null = null;
  private _consecutiveFailures = 0;
  private readonly _intervalMs: number;
  private readonly _timeoutMs: number;

  constructor(
    private readonly _identity: LimbIdentity,
    private readonly _killSwitch: KillSwitchReceiver,
    private readonly _coreUrl: string,
    opts: IdentityCommandReceiverOptions = {},
  ) {
    this._intervalMs = opts.intervalMs ?? IDENTITY_COMMAND_POLL_INTERVAL_MS;
    this._timeoutMs = opts.timeoutMs ?? 10_000;
  }

  get isRunning(): boolean {
    return this._running;
  }

  get lastPollAt(): Date | null {
    return this._lastPollAt;
  }

  get lastCommand(): IdentityCommand | null {
    return this._lastCommand;
  }

  get lastError(): Error | null {
    return this._lastError;
  }

  get consecutiveFailures(): number {
    return this._consecutiveFailures;
  }

  /**
   * Start the poll loop. First tick fires after intervalMs — Core needs time
   * to observe the registration before being queried for commands.
   */
  start(): void {
    if (this._running) return;
    this._running = true;
    this._scheduleNext(this._intervalMs);
  }

  /** Stop the poll loop gracefully. */
  stop(): void {
    this._running = false;
    if (this._timer !== null) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }

  private _scheduleNext(delayMs: number): void {
    this._timer = setTimeout(() => {
      void this._poll();
    }, delayMs);
  }

  private async _poll(): Promise<void> {
    if (!this._running) return;

    try {
      const command = await this._fetchCommand();
      if (command !== null) {
        this._applyCommand(command);
      }
      this._lastPollAt = new Date();
      this._lastError = null;
      this._consecutiveFailures = 0;
    } catch (err) {
      this._consecutiveFailures++;
      this._lastError = err instanceof Error ? err : new Error(String(err));
      console.warn(
        JSON.stringify({
          level: 'warn',
          component: 'kernel-identity-command-receiver',
          event: 'command_poll_failed',
          limbId: this._identity.limbId,
          consecutiveFailures: this._consecutiveFailures,
          error: this._lastError.message,
        }),
      );
    }

    // `stop()` may have fired while awaiting the fetch above.
    // On kill-switch activation, _running is still true — the caller
    // (Limb.terminate) is responsible for stopping the receiver.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (this._running) {
      this._scheduleNext(this._intervalMs);
    }
  }

  private _applyCommand(command: IdentityCommand): void {
    this._lastCommand = command;

    if (command.action === 'revoke') {
      console.warn(
        JSON.stringify({
          level: 'warn',
          component: 'kernel-identity-command-receiver',
          event: 'kill_switch_activating',
          limbId: this._identity.limbId,
          reason: command.reason,
        }),
      );
      this._killSwitch.activate(command.reason);
      return;
    }

    // action === 'rotate' — exhaustive by the IdentityAction union.
    // Key rotation is a multi-step protocol (regenerate keypair + re-register).
    // Emit structured log so operators can trigger the rotation procedure.
    console.warn(
      JSON.stringify({
        level: 'warn',
        component: 'kernel-identity-command-receiver',
        event: 'rotate_command_received',
        limbId: this._identity.limbId,
        reason: command.reason,
        note: 'rotation requires operator-initiated restart with fresh identity',
      }),
    );
  }

  private async _fetchCommand(): Promise<IdentityCommand | null> {
    const url = `${this._coreUrl}/limbs/${this._identity.limbId}/commands/identity/pending`;
    const headers = await this._identity.signRequest();

    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, this._timeoutMs);

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          ...headers,
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    // 204 = no pending command (steady state)
    if (response.status === 204) {
      return null;
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(
        `Core rejected command poll: HTTP ${response.status.toString()} ${body.slice(0, 200)}`,
      );
    }

    const parsed: unknown = await response.json();
    if (!this._isValidCommand(parsed)) {
      throw new Error('Core returned malformed IdentityCommand');
    }

    if (parsed.limb_id !== this._identity.limbId) {
      throw new Error(
        `Core returned command for wrong limb: ${parsed.limb_id} (expected ${this._identity.limbId})`,
      );
    }

    return parsed;
  }

  private _isValidCommand(x: unknown): x is IdentityCommand {
    if (typeof x !== 'object' || x === null) return false;
    const r = x as Record<string, unknown>;
    return (
      (r['action'] === 'revoke' || r['action'] === 'rotate') &&
      typeof r['limb_id'] === 'string' &&
      typeof r['reason'] === 'string'
    );
  }
}
