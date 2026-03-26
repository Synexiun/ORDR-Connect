/**
 * Message delivery state machine — deterministic status transitions
 *
 * COMPLIANCE: Every transition is logged for audit trail. Invalid transitions
 * throw immediately — the state machine is the single source of truth for
 * message lifecycle management.
 *
 * State diagram:
 *   pending → queued → sent → delivered (happy path)
 *   sent → failed → retrying → queued (retry loop)
 *   sent → bounced (permanent failure)
 *   failed → dlq (after max retries)
 *   any → opted_out (when customer opts out)
 */

import type { MessageStatus, MessageEvent } from './types.js';
import { MESSAGE_STATUSES, MESSAGE_EVENTS } from './types.js';

// ─── Transition Table ────────────────────────────────────────────

type TransitionMap = Readonly<Record<string, MessageStatus | undefined>>;

/**
 * Key format: `${currentStatus}:${event}`
 * Value: next status (undefined = invalid transition)
 */
const TRANSITIONS: TransitionMap = {
  // Happy path
  [`${MESSAGE_STATUSES.PENDING}:${MESSAGE_EVENTS.ENQUEUE}`]: MESSAGE_STATUSES.QUEUED,
  [`${MESSAGE_STATUSES.QUEUED}:${MESSAGE_EVENTS.SEND}`]: MESSAGE_STATUSES.SENT,
  [`${MESSAGE_STATUSES.SENT}:${MESSAGE_EVENTS.DELIVER}`]: MESSAGE_STATUSES.DELIVERED,

  // Failure from sent
  [`${MESSAGE_STATUSES.SENT}:${MESSAGE_EVENTS.FAIL}`]: MESSAGE_STATUSES.FAILED,
  [`${MESSAGE_STATUSES.SENT}:${MESSAGE_EVENTS.BOUNCE}`]: MESSAGE_STATUSES.BOUNCED,

  // Failure from queued (provider rejects immediately)
  [`${MESSAGE_STATUSES.QUEUED}:${MESSAGE_EVENTS.FAIL}`]: MESSAGE_STATUSES.FAILED,

  // Retry loop
  [`${MESSAGE_STATUSES.FAILED}:${MESSAGE_EVENTS.RETRY}`]: MESSAGE_STATUSES.RETRYING,
  [`${MESSAGE_STATUSES.RETRYING}:${MESSAGE_EVENTS.ENQUEUE}`]: MESSAGE_STATUSES.QUEUED,

  // Dead letter queue (after max retries)
  [`${MESSAGE_STATUSES.FAILED}:${MESSAGE_EVENTS.DLQ}`]: MESSAGE_STATUSES.DLQ,

  // Opt-out from any non-terminal state
  [`${MESSAGE_STATUSES.PENDING}:${MESSAGE_EVENTS.OPT_OUT}`]: MESSAGE_STATUSES.OPTED_OUT,
  [`${MESSAGE_STATUSES.QUEUED}:${MESSAGE_EVENTS.OPT_OUT}`]: MESSAGE_STATUSES.OPTED_OUT,
  [`${MESSAGE_STATUSES.SENT}:${MESSAGE_EVENTS.OPT_OUT}`]: MESSAGE_STATUSES.OPTED_OUT,
  [`${MESSAGE_STATUSES.FAILED}:${MESSAGE_EVENTS.OPT_OUT}`]: MESSAGE_STATUSES.OPTED_OUT,
  [`${MESSAGE_STATUSES.RETRYING}:${MESSAGE_EVENTS.OPT_OUT}`]: MESSAGE_STATUSES.OPTED_OUT,
} as const;

// ─── Terminal States ─────────────────────────────────────────────

const TERMINAL_STATES: ReadonlySet<MessageStatus> = new Set([
  MESSAGE_STATUSES.DELIVERED,
  MESSAGE_STATUSES.BOUNCED,
  MESSAGE_STATUSES.OPTED_OUT,
  MESSAGE_STATUSES.DLQ,
]);

// ─── State Machine ───────────────────────────────────────────────

export class MessageStateMachine {
  /**
   * Compute the next status given a current status and event.
   * Throws on invalid transitions — the state machine is deterministic.
   */
  transition(current: MessageStatus, event: MessageEvent): MessageStatus {
    const key = `${current}:${event}`;
    const next = TRANSITIONS[key];

    if (next === undefined) {
      throw new InvalidTransitionError(current, event);
    }

    return next;
  }

  /**
   * Returns true if the status represents a final state — no further
   * transitions are possible (except opt_out which is itself terminal).
   */
  isTerminal(status: MessageStatus): boolean {
    return TERMINAL_STATES.has(status);
  }

  /**
   * Returns true if the message can be retried from its current state.
   * A message can retry only if:
   * 1. It is in the FAILED state
   * 2. The attempt count has not exceeded maxRetries
   */
  canRetry(status: MessageStatus, attempts: number, maxRetries: number): boolean {
    if (status !== MESSAGE_STATUSES.FAILED) {
      return false;
    }
    return attempts < maxRetries;
  }

  /**
   * Get all valid events for a given status.
   */
  validEvents(status: MessageStatus): readonly MessageEvent[] {
    const events: MessageEvent[] = [];
    for (const event of Object.values(MESSAGE_EVENTS)) {
      const key = `${status}:${event}`;
      if (TRANSITIONS[key] !== undefined) {
        events.push(event);
      }
    }
    return events;
  }
}

// ─── Error ───────────────────────────────────────────────────────

export class InvalidTransitionError extends Error {
  public readonly currentStatus: MessageStatus;
  public readonly event: MessageEvent;

  constructor(currentStatus: MessageStatus, event: MessageEvent) {
    super(
      `Invalid state transition: cannot apply event '${event}' to status '${currentStatus}'`,
    );
    this.name = 'InvalidTransitionError';
    this.currentStatus = currentStatus;
    this.event = event;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
