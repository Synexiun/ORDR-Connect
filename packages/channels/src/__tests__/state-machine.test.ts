import { describe, it, expect } from 'vitest';
import { MessageStateMachine, InvalidTransitionError } from '../state-machine.js';
import { MESSAGE_STATUSES, MESSAGE_EVENTS } from '../types.js';

// ─── Setup ───────────────────────────────────────────────────────

const sm = new MessageStateMachine();

// ─── Happy Path ──────────────────────────────────────────────────

describe('MessageStateMachine — happy path', () => {
  it('transitions pending → queued on enqueue', () => {
    expect(sm.transition(MESSAGE_STATUSES.PENDING, MESSAGE_EVENTS.ENQUEUE)).toBe(
      MESSAGE_STATUSES.QUEUED,
    );
  });

  it('transitions queued → sent on send', () => {
    expect(sm.transition(MESSAGE_STATUSES.QUEUED, MESSAGE_EVENTS.SEND)).toBe(
      MESSAGE_STATUSES.SENT,
    );
  });

  it('transitions sent → delivered on deliver', () => {
    expect(sm.transition(MESSAGE_STATUSES.SENT, MESSAGE_EVENTS.DELIVER)).toBe(
      MESSAGE_STATUSES.DELIVERED,
    );
  });

  it('completes full happy path: pending → queued → sent → delivered', () => {
    let status = MESSAGE_STATUSES.PENDING;
    status = sm.transition(status, MESSAGE_EVENTS.ENQUEUE);
    expect(status).toBe(MESSAGE_STATUSES.QUEUED);
    status = sm.transition(status, MESSAGE_EVENTS.SEND);
    expect(status).toBe(MESSAGE_STATUSES.SENT);
    status = sm.transition(status, MESSAGE_EVENTS.DELIVER);
    expect(status).toBe(MESSAGE_STATUSES.DELIVERED);
  });
});

// ─── Failure Path ────────────────────────────────────────────────

describe('MessageStateMachine — failure and retry', () => {
  it('transitions sent → failed on fail', () => {
    expect(sm.transition(MESSAGE_STATUSES.SENT, MESSAGE_EVENTS.FAIL)).toBe(
      MESSAGE_STATUSES.FAILED,
    );
  });

  it('transitions queued → failed on fail', () => {
    expect(sm.transition(MESSAGE_STATUSES.QUEUED, MESSAGE_EVENTS.FAIL)).toBe(
      MESSAGE_STATUSES.FAILED,
    );
  });

  it('transitions sent → bounced on bounce', () => {
    expect(sm.transition(MESSAGE_STATUSES.SENT, MESSAGE_EVENTS.BOUNCE)).toBe(
      MESSAGE_STATUSES.BOUNCED,
    );
  });

  it('transitions failed → retrying on retry', () => {
    expect(sm.transition(MESSAGE_STATUSES.FAILED, MESSAGE_EVENTS.RETRY)).toBe(
      MESSAGE_STATUSES.RETRYING,
    );
  });

  it('transitions retrying → queued on enqueue', () => {
    expect(sm.transition(MESSAGE_STATUSES.RETRYING, MESSAGE_EVENTS.ENQUEUE)).toBe(
      MESSAGE_STATUSES.QUEUED,
    );
  });

  it('transitions failed → dlq on dlq event', () => {
    expect(sm.transition(MESSAGE_STATUSES.FAILED, MESSAGE_EVENTS.DLQ)).toBe(
      MESSAGE_STATUSES.DLQ,
    );
  });

  it('completes full retry loop: sent → failed → retrying → queued → sent → delivered', () => {
    let status = MESSAGE_STATUSES.SENT;
    status = sm.transition(status, MESSAGE_EVENTS.FAIL);
    expect(status).toBe(MESSAGE_STATUSES.FAILED);
    status = sm.transition(status, MESSAGE_EVENTS.RETRY);
    expect(status).toBe(MESSAGE_STATUSES.RETRYING);
    status = sm.transition(status, MESSAGE_EVENTS.ENQUEUE);
    expect(status).toBe(MESSAGE_STATUSES.QUEUED);
    status = sm.transition(status, MESSAGE_EVENTS.SEND);
    expect(status).toBe(MESSAGE_STATUSES.SENT);
    status = sm.transition(status, MESSAGE_EVENTS.DELIVER);
    expect(status).toBe(MESSAGE_STATUSES.DELIVERED);
  });
});

// ─── Opt-Out ─────────────────────────────────────────────────────

describe('MessageStateMachine — opt-out from any non-terminal state', () => {
  it('transitions pending → opted_out on opt_out', () => {
    expect(sm.transition(MESSAGE_STATUSES.PENDING, MESSAGE_EVENTS.OPT_OUT)).toBe(
      MESSAGE_STATUSES.OPTED_OUT,
    );
  });

  it('transitions queued → opted_out on opt_out', () => {
    expect(sm.transition(MESSAGE_STATUSES.QUEUED, MESSAGE_EVENTS.OPT_OUT)).toBe(
      MESSAGE_STATUSES.OPTED_OUT,
    );
  });

  it('transitions sent → opted_out on opt_out', () => {
    expect(sm.transition(MESSAGE_STATUSES.SENT, MESSAGE_EVENTS.OPT_OUT)).toBe(
      MESSAGE_STATUSES.OPTED_OUT,
    );
  });

  it('transitions failed → opted_out on opt_out', () => {
    expect(sm.transition(MESSAGE_STATUSES.FAILED, MESSAGE_EVENTS.OPT_OUT)).toBe(
      MESSAGE_STATUSES.OPTED_OUT,
    );
  });

  it('transitions retrying → opted_out on opt_out', () => {
    expect(sm.transition(MESSAGE_STATUSES.RETRYING, MESSAGE_EVENTS.OPT_OUT)).toBe(
      MESSAGE_STATUSES.OPTED_OUT,
    );
  });
});

// ─── Invalid Transitions ─────────────────────────────────────────

describe('MessageStateMachine — invalid transitions throw', () => {
  it('throws on delivered → send (terminal state)', () => {
    expect(() => sm.transition(MESSAGE_STATUSES.DELIVERED, MESSAGE_EVENTS.SEND)).toThrow(
      InvalidTransitionError,
    );
  });

  it('throws on bounced → retry (terminal state)', () => {
    expect(() => sm.transition(MESSAGE_STATUSES.BOUNCED, MESSAGE_EVENTS.RETRY)).toThrow(
      InvalidTransitionError,
    );
  });

  it('throws on opted_out → enqueue (terminal state)', () => {
    expect(() => sm.transition(MESSAGE_STATUSES.OPTED_OUT, MESSAGE_EVENTS.ENQUEUE)).toThrow(
      InvalidTransitionError,
    );
  });

  it('throws on dlq → retry (terminal state)', () => {
    expect(() => sm.transition(MESSAGE_STATUSES.DLQ, MESSAGE_EVENTS.RETRY)).toThrow(
      InvalidTransitionError,
    );
  });

  it('throws on pending → deliver (skip queued and sent)', () => {
    expect(() => sm.transition(MESSAGE_STATUSES.PENDING, MESSAGE_EVENTS.DELIVER)).toThrow(
      InvalidTransitionError,
    );
  });

  it('InvalidTransitionError contains current status and event', () => {
    try {
      sm.transition(MESSAGE_STATUSES.DELIVERED, MESSAGE_EVENTS.SEND);
      expect.fail('Should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidTransitionError);
      const error = e as InvalidTransitionError;
      expect(error.currentStatus).toBe(MESSAGE_STATUSES.DELIVERED);
      expect(error.event).toBe(MESSAGE_EVENTS.SEND);
      expect(error.message).toContain('delivered');
      expect(error.message).toContain('send');
    }
  });
});

// ─── Terminal States ─────────────────────────────────────────────

describe('MessageStateMachine — isTerminal', () => {
  it('delivered is terminal', () => {
    expect(sm.isTerminal(MESSAGE_STATUSES.DELIVERED)).toBe(true);
  });

  it('bounced is terminal', () => {
    expect(sm.isTerminal(MESSAGE_STATUSES.BOUNCED)).toBe(true);
  });

  it('opted_out is terminal', () => {
    expect(sm.isTerminal(MESSAGE_STATUSES.OPTED_OUT)).toBe(true);
  });

  it('dlq is terminal', () => {
    expect(sm.isTerminal(MESSAGE_STATUSES.DLQ)).toBe(true);
  });

  it('pending is NOT terminal', () => {
    expect(sm.isTerminal(MESSAGE_STATUSES.PENDING)).toBe(false);
  });

  it('queued is NOT terminal', () => {
    expect(sm.isTerminal(MESSAGE_STATUSES.QUEUED)).toBe(false);
  });

  it('sent is NOT terminal', () => {
    expect(sm.isTerminal(MESSAGE_STATUSES.SENT)).toBe(false);
  });

  it('failed is NOT terminal', () => {
    expect(sm.isTerminal(MESSAGE_STATUSES.FAILED)).toBe(false);
  });

  it('retrying is NOT terminal', () => {
    expect(sm.isTerminal(MESSAGE_STATUSES.RETRYING)).toBe(false);
  });
});

// ─── canRetry ────────────────────────────────────────────────────

describe('MessageStateMachine — canRetry', () => {
  it('returns true for failed with attempts < maxRetries', () => {
    expect(sm.canRetry(MESSAGE_STATUSES.FAILED, 1, 3)).toBe(true);
    expect(sm.canRetry(MESSAGE_STATUSES.FAILED, 2, 3)).toBe(true);
  });

  it('returns false for failed with attempts >= maxRetries', () => {
    expect(sm.canRetry(MESSAGE_STATUSES.FAILED, 3, 3)).toBe(false);
    expect(sm.canRetry(MESSAGE_STATUSES.FAILED, 5, 3)).toBe(false);
  });

  it('returns false for non-failed states', () => {
    expect(sm.canRetry(MESSAGE_STATUSES.PENDING, 0, 3)).toBe(false);
    expect(sm.canRetry(MESSAGE_STATUSES.SENT, 1, 3)).toBe(false);
    expect(sm.canRetry(MESSAGE_STATUSES.DELIVERED, 0, 3)).toBe(false);
    expect(sm.canRetry(MESSAGE_STATUSES.RETRYING, 1, 3)).toBe(false);
  });

  it('returns false when maxRetries is 0', () => {
    expect(sm.canRetry(MESSAGE_STATUSES.FAILED, 0, 0)).toBe(false);
  });
});

// ─── validEvents ─────────────────────────────────────────────────

describe('MessageStateMachine — validEvents', () => {
  it('pending has enqueue and opt_out', () => {
    const events = sm.validEvents(MESSAGE_STATUSES.PENDING);
    expect(events).toContain(MESSAGE_EVENTS.ENQUEUE);
    expect(events).toContain(MESSAGE_EVENTS.OPT_OUT);
    expect(events).not.toContain(MESSAGE_EVENTS.SEND);
  });

  it('delivered (terminal) has no valid events', () => {
    const events = sm.validEvents(MESSAGE_STATUSES.DELIVERED);
    expect(events).toHaveLength(0);
  });

  it('failed has retry, opt_out, and dlq', () => {
    const events = sm.validEvents(MESSAGE_STATUSES.FAILED);
    expect(events).toContain(MESSAGE_EVENTS.RETRY);
    expect(events).toContain(MESSAGE_EVENTS.OPT_OUT);
    expect(events).toContain(MESSAGE_EVENTS.DLQ);
  });
});
