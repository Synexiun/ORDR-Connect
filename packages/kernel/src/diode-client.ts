/**
 * DiodeClient — HTTP client for the Synexiun upward data diode.
 *
 * All messages flow upward: limb → Core.
 * No lateral communication (limb → limb) is permitted.
 * No downward writes from this client (diode is unidirectional for writes).
 *
 * Endpoint: POST {SYNEX_CORE_URL}/diode/upward
 * Auth: Ed25519 signed headers (X-Synex-Limb-Id, X-Synex-Timestamp, X-Synex-Signature)
 *
 * TypeScript port of the upward channel described in synex_core/routes/diode.py
 *
 * RULE 1 (Encryption): TLS 1.3+ required for all Core communication.
 * RULE 3 (Audit): Every diode message is audit-logged by Core (WORM).
 */

import type { LimbIdentity } from './identity.js';
import type {
  AuditReport,
  BudgetReport,
  DiodeAcceptResponse,
  HealthBeacon,
  UpwardMessage,
} from './types.js';
import { CORE_ID } from './constants.js';
import { LateralGuard } from './lateral-guard.js';

export class DiodeError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly body?: string,
  ) {
    super(message);
    this.name = 'DiodeError';
  }
}

export interface DiodeClientOptions {
  /** Base URL of the Synex Core server. e.g. https://core.synexiun.internal:8100 */
  coreUrl: string;
  /** Request timeout in milliseconds. Default: 10_000. */
  timeoutMs?: number;
}

export class DiodeClient {
  private readonly _guard: LateralGuard;
  private readonly _timeoutMs: number;

  constructor(
    private readonly _identity: LimbIdentity,
    private readonly _opts: DiodeClientOptions,
  ) {
    this._guard = new LateralGuard(_identity.limbId);
    this._timeoutMs = _opts.timeoutMs ?? 10_000;
  }

  /** Send a health beacon upward to Core. */
  async sendHealthBeacon(beacon: HealthBeacon): Promise<DiodeAcceptResponse> {
    return this._send({ type: 'health_beacon', payload: beacon });
  }

  /** Send an audit chain snapshot upward to Core. */
  async sendAuditReport(report: AuditReport): Promise<DiodeAcceptResponse> {
    return this._send({ type: 'audit_report', payload: report });
  }

  /** Send a budget consumption report upward to Core. */
  async sendBudgetReport(report: BudgetReport): Promise<DiodeAcceptResponse> {
    return this._send({ type: 'budget_report', payload: report });
  }

  private async _send(msg: UpwardMessage): Promise<DiodeAcceptResponse> {
    // Enforce data diode — only communication with Core is allowed
    this._guard.check(CORE_ID);

    const headers = await this._identity.signRequest();
    const url = `${this._opts.coreUrl}/diode/upward`;

    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, this._timeoutMs);

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
        body: JSON.stringify(msg),
        signal: controller.signal,
      });
    } catch (err) {
      throw new DiodeError(
        `Diode POST failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new DiodeError(
        `Core rejected diode message: HTTP ${response.status.toString()}`,
        response.status,
        body,
      );
    }

    return response.json() as Promise<DiodeAcceptResponse>;
  }
}
