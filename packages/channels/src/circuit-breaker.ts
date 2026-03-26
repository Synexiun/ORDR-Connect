/**
 * Circuit breaker — per-channel resilience pattern for ORDR-Connect
 *
 * COMPLIANCE:
 * - SOC2 (Availability): Prevents cascade failures across channels
 * - Protects downstream providers (Twilio, SendGrid) from overload
 * - State transitions are deterministic and testable
 *
 * States:
 *   closed    → healthy, all requests pass through
 *   open      → failing, all requests short-circuited
 *   half_open → testing, limited requests allowed to probe recovery
 *
 * Transitions:
 *   closed    → open      (failure count exceeds threshold)
 *   open      → half_open (reset timeout elapsed)
 *   half_open → closed    (test request succeeds)
 *   half_open → open      (test request fails)
 */

import {
  type Result,
  ok,
  err,
  InternalError,
} from '@ordr/core';

// ─── Circuit Breaker State ──────────────────────────────────────

export const CIRCUIT_STATES = {
  CLOSED: 'closed',
  OPEN: 'open',
  HALF_OPEN: 'half_open',
} as const;

export type CircuitState = (typeof CIRCUIT_STATES)[keyof typeof CIRCUIT_STATES];

// ─── Config ─────────────────────────────────────────────────────

export interface CircuitBreakerConfig {
  readonly failureThreshold: number;
  readonly resetTimeoutMs: number;
  readonly halfOpenMaxAttempts: number;
}

export const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  resetTimeoutMs: 30_000,
  halfOpenMaxAttempts: 3,
} as const;

// ─── Circuit Breaker ────────────────────────────────────────────

export class CircuitBreaker {
  private state: CircuitState;
  private failureCount: number;
  private lastFailureTime: number;
  private halfOpenAttempts: number;
  private readonly config: CircuitBreakerConfig;
  private readonly name: string;

  /**
   * Provider for current time — injectable for testing.
   * Defaults to Date.now.
   */
  private readonly now: () => number;

  constructor(
    name: string,
    config?: Partial<CircuitBreakerConfig>,
    now?: () => number,
  ) {
    this.name = name;
    this.config = {
      ...DEFAULT_CIRCUIT_BREAKER_CONFIG,
      ...config,
    };
    this.state = CIRCUIT_STATES.CLOSED;
    this.failureCount = 0;
    this.lastFailureTime = 0;
    this.halfOpenAttempts = 0;
    this.now = now ?? Date.now;
  }

  /**
   * Execute a function through the circuit breaker.
   *
   * - CLOSED: Execute normally; track failures.
   * - OPEN: Reject immediately (fast fail); check if reset timeout elapsed.
   * - HALF_OPEN: Allow limited test executions; decide based on result.
   */
  async execute<T>(fn: () => Promise<T>): Promise<Result<T, InternalError>> {
    // Check if we should transition from open → half_open
    if (this.state === CIRCUIT_STATES.OPEN) {
      const timeSinceFailure = this.now() - this.lastFailureTime;
      if (timeSinceFailure >= this.config.resetTimeoutMs) {
        this.state = CIRCUIT_STATES.HALF_OPEN;
        this.halfOpenAttempts = 0;
      } else {
        return err(
          new InternalError(
            `Circuit breaker '${this.name}' is open — channel unavailable`,
          ),
        );
      }
    }

    // Half-open: check if we've exceeded test attempts
    if (this.state === CIRCUIT_STATES.HALF_OPEN) {
      if (this.halfOpenAttempts >= this.config.halfOpenMaxAttempts) {
        // Too many half-open attempts without success — re-open
        this.tripOpen();
        return err(
          new InternalError(
            `Circuit breaker '${this.name}' re-opened after failed recovery`,
          ),
        );
      }
      this.halfOpenAttempts++;
    }

    try {
      const result = await fn();

      // Success path
      if (this.state === CIRCUIT_STATES.HALF_OPEN) {
        // Recovery successful — close the circuit
        this.reset();
      } else {
        // Reset failure count on success in closed state
        this.failureCount = 0;
      }

      return ok(result);
    } catch (error: unknown) {
      this.recordFailure();

      // SECURITY: Never expose raw errors — wrap with safe message
      const safeMessage = error instanceof Error
        ? `Channel '${this.name}' operation failed`
        : `Channel '${this.name}' operation failed due to unknown error`;

      return err(new InternalError(safeMessage));
    }
  }

  /**
   * Get the current circuit state.
   */
  getState(): CircuitState {
    // Check for pending transition from open → half_open
    if (this.state === CIRCUIT_STATES.OPEN) {
      const timeSinceFailure = this.now() - this.lastFailureTime;
      if (timeSinceFailure >= this.config.resetTimeoutMs) {
        return CIRCUIT_STATES.HALF_OPEN;
      }
    }
    return this.state;
  }

  /**
   * Get the current failure count.
   */
  getFailureCount(): number {
    return this.failureCount;
  }

  /**
   * Get the circuit breaker name.
   */
  getName(): string {
    return this.name;
  }

  /**
   * Check if the circuit is allowing requests.
   */
  isAvailable(): boolean {
    const state = this.getState();
    return state === CIRCUIT_STATES.CLOSED || state === CIRCUIT_STATES.HALF_OPEN;
  }

  /**
   * Manually reset the circuit breaker to closed state.
   * Used in testing and administrative recovery.
   */
  reset(): void {
    this.state = CIRCUIT_STATES.CLOSED;
    this.failureCount = 0;
    this.lastFailureTime = 0;
    this.halfOpenAttempts = 0;
  }

  // ─── Private ─────────────────────────────────────────────────

  private recordFailure(): void {
    this.failureCount++;
    this.lastFailureTime = this.now();

    if (this.state === CIRCUIT_STATES.HALF_OPEN) {
      // Any failure in half-open → re-open
      this.tripOpen();
    } else if (this.failureCount >= this.config.failureThreshold) {
      // Threshold exceeded → open
      this.tripOpen();
    }
  }

  private tripOpen(): void {
    this.state = CIRCUIT_STATES.OPEN;
    this.lastFailureTime = this.now();
    this.halfOpenAttempts = 0;
  }
}
