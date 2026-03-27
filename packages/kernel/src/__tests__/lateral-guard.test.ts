import { describe, it, expect } from 'vitest';
import { LateralGuard, LateralCommunicationError } from '../lateral-guard.js';
import { CORE_ID } from '../constants.js';

const OWN_ID = 'synexcom-ordr-001';

describe('LateralGuard', () => {
  it('allows communication with Core', () => {
    const guard = new LateralGuard(OWN_ID);
    expect(() => {
      guard.check(CORE_ID);
    }).not.toThrow();
  });

  it('allows self-communication', () => {
    const guard = new LateralGuard(OWN_ID);
    expect(() => {
      guard.check(OWN_ID);
    }).not.toThrow();
  });

  it('blocks lateral communication with another limb', () => {
    const guard = new LateralGuard(OWN_ID);
    expect(() => {
      guard.check('some-other-limb-002');
    }).toThrow(LateralCommunicationError);
  });

  it('error message names source and target', () => {
    const guard = new LateralGuard(OWN_ID);
    try {
      guard.check('forbidden-limb');
    } catch (err) {
      expect(err).toBeInstanceOf(LateralCommunicationError);
      expect((err as LateralCommunicationError).message).toContain(OWN_ID);
      expect((err as LateralCommunicationError).message).toContain('forbidden-limb');
    }
  });

  it('records violations', () => {
    const guard = new LateralGuard(OWN_ID);
    expect(() => {
      guard.check('limb-a');
    }).toThrow();
    expect(() => {
      guard.check('limb-b');
    }).toThrow();
    expect(guard.violations).toHaveLength(2);
    expect(guard.violations[0]?.target).toBe('limb-a');
    expect(guard.violations[1]?.target).toBe('limb-b');
  });

  it('records blockedAt timestamp', () => {
    const before = new Date();
    const guard = new LateralGuard(OWN_ID);
    expect(() => {
      guard.check('x');
    }).toThrow();
    const after = new Date();
    const v = guard.violations[0];
    expect(v?.blockedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(v?.blockedAt.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it('uses a custom coreId when supplied', () => {
    const guard = new LateralGuard(OWN_ID, 'custom-core');
    expect(() => {
      guard.check('custom-core');
    }).not.toThrow();
    expect(() => {
      guard.check(CORE_ID);
    }).toThrow(); // default CORE_ID is now lateral
  });
});
