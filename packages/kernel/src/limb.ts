/**
 * Limb — Main orchestrator for ORDR-Connect's Synexiun integration.
 *
 * Wires together all five kernel subsystems:
 *   1. LimbIdentity       — Ed25519 keypair + request signing
 *   2. LimbRegistrar      — One-time Core registration
 *   3. DiodeClient        — Upward data diode HTTP client
 *   4. HeartbeatEmitter   — 30s periodic health beacon
 *   5. KillSwitchReceiver — Core-commanded shutdown
 *
 * Usage:
 *   const limb = await Limb.boot(env);
 *   // limb is now registered with Core and emitting heartbeats
 *   // On shutdown:
 *   limb.shutdown();
 *
 * TypeScript port of synex_kernel/limb.py
 *
 * RULE 2 (Auth): Registration before any diode messages.
 * RULE 9 (Agent Safety): Kill switch checked before significant operations.
 * RULE 10 (Infrastructure): Health monitoring active from startup.
 */

import { LimbIdentity } from './identity.js';
import { LimbRegistrar } from './registrar.js';
import { DiodeClient } from './diode-client.js';
import { HeartbeatEmitter } from './heartbeat.js';
import { KillSwitchReceiver } from './kill-switch.js';
import { ORDR_LIMB_ID } from './constants.js';
import type { HealthBeacon, HealthStatus, RegisterResponse } from './types.js';

export interface LimbEnv {
  /**
   * Hex-encoded Ed25519 private key.
   * Source: SYNEX_LIMB_PRIVATE_KEY environment variable.
   */
  privateKeyHex: string;
  /**
   * Base URL of the Synex Core server.
   * Source: SYNEX_CORE_URL environment variable.
   * Example: https://core.synexiun.internal:8100
   */
  coreUrl: string;
  /**
   * Admin bearer token for Core registration.
   * Source: SYNEX_CORE_ADMIN_TOKEN environment variable.
   */
  adminToken: string;
  /** Override limb ID (default: ORDR_LIMB_ID constant). */
  limbId?: string;
  /** Human-readable name shown in Core dashboard. */
  displayName?: string;
  /** Certificate validity in days (default: 365). */
  validityDays?: number;
  /** Heartbeat interval in ms (default: 30_000). */
  heartbeatIntervalMs?: number;
}

export interface LimbHealthSnapshot {
  limbId: string;
  status: HealthStatus;
  isRegistered: boolean;
  isRunning: boolean;
  isDegraded: boolean;
  consecutiveFailures: number;
  uptimeSeconds: number;
  lastBeaconAt: Date | null;
  killSwitchActivated: boolean;
}

export class Limb {
  private _registered = false;
  private _certificate: RegisterResponse | null = null;

  private constructor(
    public readonly identity: LimbIdentity,
    private readonly _registrar: LimbRegistrar,
    public readonly diode: DiodeClient,
    public readonly heartbeat: HeartbeatEmitter,
    public readonly killSwitch: KillSwitchReceiver,
  ) {}

  /**
   * Boot the limb:
   *   1. Load identity from private key hex
   *   2. Register with Core (idempotent — safe on restart)
   *   3. Start heartbeat loop
   *
   * @throws RegistrationError if Core rejects registration
   * @throws Error if private key is invalid
   */
  static async boot(env: LimbEnv): Promise<Limb> {
    const limbId = env.limbId ?? ORDR_LIMB_ID;

    const identity = await LimbIdentity.fromHex(limbId, env.privateKeyHex);

    // exactOptionalPropertyTypes: only pass optional fields if defined
    const registrarOpts: import('./registrar.js').RegistrarOptions = {
      coreUrl: env.coreUrl,
      adminToken: env.adminToken,
      ...(env.displayName !== undefined && { displayName: env.displayName }),
      ...(env.validityDays !== undefined && { validityDays: env.validityDays }),
    };
    const registrar = new LimbRegistrar(identity, registrarOpts);

    const diode = new DiodeClient(identity, { coreUrl: env.coreUrl });
    const killSwitch = new KillSwitchReceiver(limbId);

    // Collector closure captures `killSwitch` and `heartbeat` after assignment.
    // We declare `limb` and let the collector close over it via reference.
    // `let` required here: heartbeat's collector closes over `limb`, which is
    // assigned after heartbeat is constructed. ESLint prefer-const is suppressed
    // because the variable IS reassigned (from uninitialized to assigned).
    // eslint-disable-next-line prefer-const
    let limb: Limb;

    // exactOptionalPropertyTypes: only pass intervalMs if defined
    const heartbeatOpts: import('./heartbeat.js').HeartbeatOptions =
      env.heartbeatIntervalMs !== undefined ? { intervalMs: env.heartbeatIntervalMs } : {};

    const heartbeat = new HeartbeatEmitter(
      limbId,
      () => {
        // `limb` is guaranteed assigned before any heartbeat tick fires
        // because the first tick is scheduled after `start()`, which is
        // called after `limb =` below.
        return limb._collectHealth();
      },
      diode,
      heartbeatOpts,
    );

    limb = new Limb(identity, registrar, diode, heartbeat, killSwitch);

    // Step 1: Register with Core (idempotent on restart)
    limb._certificate = await registrar.register();
    limb._registered = true;

    // Step 2: Start heartbeat (first tick fires after intervalMs)
    heartbeat.start();

    return limb;
  }

  /**
   * Gracefully shut down the limb.
   * Stops the heartbeat loop. Does not deregister from Core.
   */
  shutdown(): void {
    this.heartbeat.stop();
  }

  /** True if successfully registered with Core on this boot. */
  get isRegistered(): boolean {
    return this._registered;
  }

  /** The signed certificate returned by Core during registration. */
  get certificate(): RegisterResponse | null {
    return this._certificate;
  }

  /**
   * Assert the limb is still alive before any significant operation.
   * @throws KillSwitchActivatedError if Core has terminated this limb
   */
  checkAlive(): void {
    this.killSwitch.check();
  }

  /**
   * Activate the kill switch — called when Core sends a DEAD/revoke command.
   * Immediately stops the heartbeat and marks the limb as terminated.
   * Irreversible within this process lifetime.
   */
  terminate(reason: string): void {
    this.killSwitch.activate(reason);
    this.heartbeat.stop();
  }

  /** Current health snapshot for observability endpoints. */
  get health(): LimbHealthSnapshot {
    return {
      limbId: this.identity.limbId,
      status: this.heartbeat.status,
      isRegistered: this._registered,
      isRunning: this.heartbeat.isRunning,
      isDegraded: this.heartbeat.isDegraded,
      consecutiveFailures: this.heartbeat.consecutiveFailures,
      uptimeSeconds: this.heartbeat.uptimeSeconds,
      lastBeaconAt: this.heartbeat.lastBeaconAt,
      killSwitchActivated: this.killSwitch.isActivated,
    };
  }

  /** Build the health beacon payload sent on each heartbeat tick. */
  private _collectHealth(): Omit<HealthBeacon, 'limb_id' | 'timestamp'> {
    return {
      status: this.killSwitch.isActivated ? 'dead' : this.heartbeat.status,
      budget_remaining: 1.0, // TODO: wire to real budget tracker in Phase 7
      budget_total: 1.0,
      epoch: 1,
      uptime_seconds: this.heartbeat.uptimeSeconds,
    };
  }
}
