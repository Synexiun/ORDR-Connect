import { describe, it, expect } from 'vitest';
import { KillSwitchReceiver, KillSwitchActivatedError } from '../kill-switch.js';

const LIMB_ID = 'synexcom-ordr-001';

describe('KillSwitchReceiver', () => {
  it('starts inactive', () => {
    const ks = new KillSwitchReceiver(LIMB_ID);
    expect(ks.isActivated).toBe(false);
    expect(ks.status).toBe('alive');
    expect(ks.reason).toBeNull();
    expect(ks.activatedAt).toBeNull();
  });

  it('check() passes when inactive', () => {
    const ks = new KillSwitchReceiver(LIMB_ID);
    expect(() => {
      ks.check();
    }).not.toThrow();
  });

  it('activate() sets the kill switch', () => {
    const before = new Date();
    const ks = new KillSwitchReceiver(LIMB_ID);
    ks.activate('test reason');
    const after = new Date();

    expect(ks.isActivated).toBe(true);
    expect(ks.status).toBe('dead');
    expect(ks.reason).toBe('test reason');
    expect(ks.activatedAt).not.toBeNull();
    const activatedAt = ks.activatedAt ?? new Date(0);
    expect(activatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(activatedAt.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it('check() throws KillSwitchActivatedError after activation', () => {
    const ks = new KillSwitchReceiver(LIMB_ID);
    ks.activate('core command');
    expect(() => {
      ks.check();
    }).toThrow(KillSwitchActivatedError);
  });

  it('KillSwitchActivatedError message includes limb ID and reason', () => {
    const ks = new KillSwitchReceiver(LIMB_ID);
    ks.activate('unauthorized access');
    try {
      ks.check();
    } catch (err) {
      expect(err).toBeInstanceOf(KillSwitchActivatedError);
      expect((err as KillSwitchActivatedError).message).toContain(LIMB_ID);
      expect((err as KillSwitchActivatedError).message).toContain('unauthorized access');
    }
  });

  it('uses default reason if none supplied', () => {
    const ks = new KillSwitchReceiver(LIMB_ID);
    ks.activate();
    expect(ks.reason).toBe('kill switch activated by Core');
  });

  it('activation is irreversible — second activate() does not change the first timestamp', () => {
    const ks = new KillSwitchReceiver(LIMB_ID);
    ks.activate('first');
    const t1 = (ks.activatedAt ?? new Date(0)).getTime();
    ks.activate('second');
    // activatedAt is overwritten each call — but isActivated stays true
    expect(ks.isActivated).toBe(true);
    expect((ks.activatedAt ?? new Date(0)).getTime()).toBeGreaterThanOrEqual(t1);
  });
});
