import { describe, it, expect, vi } from 'vitest';
import { DrizzleConsentStore } from '../drizzle-consent-store.js';

// ─── Mock DB ─────────────────────────────────────────────────────────────────

function makeDb(
  overrides: {
    selectRows?: unknown[];
    contactRows?: unknown[];
  } = {},
) {
  const { selectRows = [], contactRows = [] } = overrides;
  let selectCallCount = 0;

  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  chain.select = vi.fn().mockReturnThis();
  chain.from = vi.fn().mockReturnThis();
  chain.orderBy = vi.fn().mockReturnThis();
  chain.limit = vi.fn().mockImplementation(() => {
    selectCallCount++;
    // First select = getConsent or findContact, second = findContact within save/revoke
    if (selectCallCount === 1) return Promise.resolve(selectRows);
    return Promise.resolve(contactRows);
  });
  chain.where = vi.fn().mockReturnThis();
  chain.insert = vi.fn().mockReturnThis();
  chain.values = vi.fn().mockResolvedValue(undefined);
  chain.update = vi.fn().mockReturnThis();
  chain.set = vi.fn().mockReturnThis();
  return chain;
}

const CONSENT_ROW = {
  customerId: 'cust-1',
  tenantId: 't1',
  channel: 'sms',
  newStatus: 'opted_in',
  recordedAt: new Date('2026-01-15'),
  method: 'web_form',
  evidenceRef: 'form-123',
};

const CONTACT_ROW = {
  id: 'contact-1',
  tenantId: 't1',
  consentStatus: 'unknown',
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('DrizzleConsentStore', () => {
  describe('getConsent', () => {
    it('returns mapped ConsentRecord on hit', async () => {
      const db = makeDb({ selectRows: [CONSENT_ROW] });
      const store = new DrizzleConsentStore(db as never);
      const result = await store.getConsent('cust-1', 'sms');

      expect(result).not.toBeUndefined();
      expect(result?.customerId).toBe('cust-1');
      expect(result?.tenantId).toBe('t1');
      expect(result?.channel).toBe('sms');
      expect(result?.status).toBe('opted_in');
      expect(result?.method).toBe('web_form');
      expect(result?.evidenceRef).toBe('form-123');
    });

    it('returns undefined on miss', async () => {
      const db = makeDb({ selectRows: [] });
      const store = new DrizzleConsentStore(db as never);
      const result = await store.getConsent('cust-1', 'sms');
      expect(result).toBeUndefined();
    });

    it('queries ordered by recordedAt desc with limit 1', async () => {
      const db = makeDb({ selectRows: [] });
      const store = new DrizzleConsentStore(db as never);
      await store.getConsent('cust-1', 'sms');

      expect(db.select).toHaveBeenCalled();
      expect(db.orderBy).toHaveBeenCalled();
      expect(db.limit).toHaveBeenCalledWith(1);
    });
  });

  describe('saveConsent', () => {
    it('throws if no contact found', async () => {
      // findContact returns empty — no matching contact
      const db = makeDb({ selectRows: [], contactRows: [] });
      // Override: findContact is the first select call in saveConsent
      let callCount = 0;
      db.limit = vi.fn().mockImplementation(() => {
        callCount++;
        return Promise.resolve([]);
      });
      const store = new DrizzleConsentStore(db as never);

      await expect(
        store.saveConsent({
          customerId: 'cust-1',
          tenantId: 't1',
          channel: 'sms',
          status: 'opted_in',
          consentedAt: new Date(),
          method: 'web_form',
          evidenceRef: 'ref-1',
        }),
      ).rejects.toThrow('No contact found');
    });

    it('inserts WORM record and updates contact when contact exists', async () => {
      // findContact returns a contact; update().set().where() resolves void
      const db = makeDb();
      db.where = vi.fn().mockImplementation(() => ({
        limit: vi.fn().mockResolvedValue([CONTACT_ROW]),
      }));

      const store = new DrizzleConsentStore(db as never);
      await store.saveConsent({
        customerId: 'cust-1',
        tenantId: 't1',
        channel: 'sms',
        status: 'opted_in',
        consentedAt: new Date(),
        method: 'web_form',
        evidenceRef: 'ref-1',
      });

      // Should have called insert for WORM record
      expect(db.insert).toHaveBeenCalled();
      // Should have called update for contact consentStatus
      expect(db.update).toHaveBeenCalled();
    });
  });

  describe('revokeConsent', () => {
    it('silently returns if no contact found', async () => {
      const db = makeDb();
      db.limit = vi.fn().mockResolvedValue([]);
      const store = new DrizzleConsentStore(db as never);

      // Should not throw
      await store.revokeConsent('cust-1', 'sms', new Date());
      // Should NOT have called insert (no WORM record for non-existent contact)
      expect(db.insert).not.toHaveBeenCalled();
    });

    it('inserts revocation record and updates contact when contact exists', async () => {
      const db = makeDb();
      db.where = vi.fn().mockImplementation(() => ({
        limit: vi.fn().mockResolvedValue([CONTACT_ROW]),
      }));

      const store = new DrizzleConsentStore(db as never);
      await store.revokeConsent('cust-1', 'sms', new Date());

      expect(db.insert).toHaveBeenCalled();
      expect(db.update).toHaveBeenCalled();
    });
  });
});
