import { describe, it, expect } from 'vitest';
import type { AuditEventType } from '../types.js';

const DSR_AUDIT_TYPES: ReadonlyArray<AuditEventType> = [
  'dsr.requested',
  'dsr.approved',
  'dsr.rejected',
  'dsr.cancelled',
  'dsr.exported',
  'dsr.failed',
  'dsr.erasure_scheduled',
  'dsr.erasure_executed',
  'dsr.erasure_verified',
];

describe('DSR audit event types', () => {
  it('all 9 DSR audit types are valid AuditEventType values', () => {
    // This test passing means the TS union accepts all values.
    // It's a compile-time check — if AuditEventType excludes any of these
    // values, TypeScript will reject the array literal above.
    expect(DSR_AUDIT_TYPES.length).toBe(9);
  });
});
