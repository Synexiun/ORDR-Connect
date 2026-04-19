/**
 * Partner Program Route Tests — /api/v1/partners endpoints
 *
 * Tests registration, profile CRUD, earnings, payouts,
 * auth enforcement, Zod validation, and audit logging.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import { partnersRouter, configurePartnerRoutes } from '../routes/partners.js';
import { configureAuth } from '../middleware/auth.js';
import { requestId } from '../middleware/request-id.js';
import { globalErrorHandler } from '../middleware/error-handler.js';
import type { Env } from '../types.js';
import { loadKeyPair, createAccessToken } from '@ordr/auth';
import type { JwtConfig } from '@ordr/auth';
import { AuditLogger, InMemoryAuditStore } from '@ordr/audit';
import { generateKeyPair } from '@ordr/crypto';

// ─── Response type helper ─────────────────────────────────────────

type PartnerDataItem = {
  id?: string;
  name?: string;
  email?: string;
  company?: string;
  tier?: string;
  status?: string;
  revenueSharePct?: number;
  createdAt?: string;
  updatedAt?: string;
  totalCents?: number;
  pendingCents?: number;
  paidCents?: number;
  currency?: string;
  amountCents?: number;
  periodStart?: string;
  periodEnd?: string;
  paidAt?: string | null;
  partnerId?: string;
};

type PartnerData = PartnerDataItem & PartnerDataItem[];

interface PartnerBody {
  success: boolean;
  data: PartnerData;
  error?: { message?: string; code?: string };
}

// ─── Mock Data ──────────────────────────────────────────────────────

interface MockPartner {
  id: string;
  name: string;
  email: string;
  company: string;
  tier: 'silver' | 'gold' | 'platinum';
  status: 'pending' | 'active' | 'suspended';
  revenueSharePct: number;
  createdAt: Date;
  updatedAt: Date;
}

interface MockPayout {
  id: string;
  partnerId: string;
  amountCents: number;
  currency: string;
  periodStart: Date;
  periodEnd: Date;
  status: 'pending' | 'processing' | 'paid' | 'failed';
  paidAt: Date | null;
  createdAt: Date;
}

let jwtConfig: JwtConfig;
let auditLogger: AuditLogger;
let auditStore: InMemoryAuditStore;
let partnerStore: Map<string, MockPartner>;
let emailIndex: Map<string, MockPartner>;
let payoutStore: Map<string, MockPayout>;
let idCounter: number;

async function makeJwt(
  overrides: {
    readonly sub?: string;
    readonly tid?: string;
    readonly role?: string;
  } = {},
): Promise<string> {
  return createAccessToken(jwtConfig, {
    sub: overrides.sub ?? 'partner-001',
    tid: overrides.tid ?? 'partner-program',
    role: (overrides.role ?? 'tenant_admin') as 'tenant_admin',
    permissions: [],
  });
}

function createTestApp(): Hono<Env> {
  const app = new Hono<Env>();
  app.use('*', requestId);
  app.onError(globalErrorHandler);
  app.route('/api/v1/partners', partnersRouter);
  return app;
}

// ─── Setup ──────────────────────────────────────────────────────────

beforeEach(async () => {
  const { privateKey, publicKey } = generateKeyPair();
  jwtConfig = await loadKeyPair(privateKey, publicKey, {
    issuer: 'ordr-connect',
    audience: 'ordr-connect',
  });

  configureAuth(jwtConfig);

  auditStore = new InMemoryAuditStore();
  auditLogger = new AuditLogger(auditStore);

  partnerStore = new Map<string, MockPartner>();
  emailIndex = new Map<string, MockPartner>();
  payoutStore = new Map<string, MockPayout>();
  idCounter = 1;

  configurePartnerRoutes({
    auditLogger,
    findPartnerByEmail: vi.fn((email: string) => Promise.resolve(emailIndex.get(email) ?? null)),
    findPartnerById: vi.fn((id: string) => Promise.resolve(partnerStore.get(id) ?? null)),
    createPartner: vi.fn((data: { name: string; email: string; company: string; tier: string }) => {
      const id = `partner-${String(idCounter++).padStart(3, '0')}`;
      const partner: MockPartner = {
        id,
        name: data.name,
        email: data.email,
        company: data.company,
        tier: data.tier as 'silver' | 'gold' | 'platinum',
        status: 'pending',
        revenueSharePct: 10,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      partnerStore.set(id, partner);
      emailIndex.set(data.email, partner);
      return Promise.resolve(partner);
    }),
    updatePartner: vi.fn((id: string, data: { name?: string; company?: string }) => {
      const partner = partnerStore.get(id);
      if (!partner) return Promise.resolve(null);
      const updated: MockPartner = {
        ...partner,
        name: data.name ?? partner.name,
        company: data.company ?? partner.company,
        updatedAt: new Date(),
      };
      partnerStore.set(id, updated);
      emailIndex.set(updated.email, updated);
      return Promise.resolve(updated);
    }),
    getEarnings: vi.fn(() =>
      Promise.resolve({
        totalCents: 458200,
        pendingCents: 85000,
        paidCents: 373200,
        currency: 'USD',
      }),
    ),
    listPayouts: vi.fn((partnerId: string) => {
      const payouts: MockPayout[] = [];
      for (const p of payoutStore.values()) {
        if (p.partnerId === partnerId) payouts.push(p);
      }
      return Promise.resolve(payouts);
    }),
  });
});

// ─── Helper: seed a partner ────────────────────────────────────────

function seedPartner(overrides: Partial<MockPartner> = {}): MockPartner {
  const id = overrides.id ?? 'partner-001';
  const partner: MockPartner = {
    id,
    name: overrides.name ?? 'Test Partner',
    email: overrides.email ?? 'partner@example.com',
    company: overrides.company ?? 'Partner Corp',
    tier: overrides.tier ?? 'gold',
    status: overrides.status ?? 'active',
    revenueSharePct: overrides.revenueSharePct ?? 20,
    createdAt: overrides.createdAt ?? new Date('2025-01-01'),
    updatedAt: overrides.updatedAt ?? new Date('2025-01-01'),
  };
  partnerStore.set(id, partner);
  emailIndex.set(partner.email, partner);
  return partner;
}

function seedPayout(overrides: Partial<MockPayout> = {}): MockPayout {
  const id = overrides.id ?? `payout-${String(idCounter++).padStart(3, '0')}`;
  const payout: MockPayout = {
    id,
    partnerId: overrides.partnerId ?? 'partner-001',
    amountCents: overrides.amountCents ?? 100000,
    currency: overrides.currency ?? 'USD',
    periodStart: overrides.periodStart ?? new Date('2025-01-01'),
    periodEnd: overrides.periodEnd ?? new Date('2025-01-31'),
    status: overrides.status ?? 'paid',
    paidAt: overrides.paidAt ?? new Date('2025-02-01'),
    createdAt: overrides.createdAt ?? new Date('2025-02-01'),
  };
  payoutStore.set(id, payout);
  return payout;
}

// ═══════════════════════════════════════════════════════════════════
// POST /api/v1/partners/register
// ═══════════════════════════════════════════════════════════════════

describe('POST /api/v1/partners/register', () => {
  it('creates a new partner account', async () => {
    const app = createTestApp();
    const token = await makeJwt();

    const res = await app.request('/api/v1/partners/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        name: 'New Partner',
        email: 'new@partner.com',
        company: 'Partner Inc',
        tier: 'gold',
      }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as PartnerBody;
    expect(body.success).toBe(true);
    expect(body.data.email).toBe('new@partner.com');
    expect(body.data.company).toBe('Partner Inc');
    expect(body.data.tier).toBe('gold');
  });

  it('returns 201 with default tier when not specified', async () => {
    const app = createTestApp();
    const token = await makeJwt();

    const res = await app.request('/api/v1/partners/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        name: 'Default Tier Partner',
        email: 'default@partner.com',
        company: 'Default Corp',
      }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as PartnerBody;
    expect(body.data.tier).toBe('silver');
  });

  it('rejects duplicate email with 409', async () => {
    seedPartner({ email: 'existing@partner.com' });
    const app = createTestApp();
    const token = await makeJwt();

    const res = await app.request('/api/v1/partners/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        name: 'Duplicate',
        email: 'existing@partner.com',
        company: 'Dup Corp',
      }),
    });

    expect(res.status).toBe(409);
  });

  it('validates email format', async () => {
    const app = createTestApp();
    const token = await makeJwt();

    const res = await app.request('/api/v1/partners/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        name: 'Bad Email',
        email: 'not-an-email',
        company: 'Bad Corp',
      }),
    });

    expect(res.status).toBe(400);
  });

  it('rejects missing name', async () => {
    const app = createTestApp();
    const token = await makeJwt();

    const res = await app.request('/api/v1/partners/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        email: 'noname@partner.com',
        company: 'No Name Corp',
      }),
    });

    expect(res.status).toBe(400);
  });

  it('rejects missing company', async () => {
    const app = createTestApp();
    const token = await makeJwt();

    const res = await app.request('/api/v1/partners/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        name: 'No Company',
        email: 'nocompany@partner.com',
      }),
    });

    expect(res.status).toBe(400);
  });

  it('rejects invalid tier value', async () => {
    const app = createTestApp();
    const token = await makeJwt();

    const res = await app.request('/api/v1/partners/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        name: 'Bad Tier',
        email: 'badtier@partner.com',
        company: 'Bad Tier Corp',
        tier: 'diamond',
      }),
    });

    expect(res.status).toBe(400);
  });

  it('returns 401 when unauthenticated', async () => {
    const app = createTestApp();

    const res = await app.request('/api/v1/partners/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Unauth',
        email: 'unauth@partner.com',
        company: 'Unauth Corp',
      }),
    });

    expect(res.status).toBe(401);
  });

  it('audit-logs the registration', async () => {
    const app = createTestApp();
    const token = await makeJwt();

    await app.request('/api/v1/partners/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        name: 'Audit Partner',
        email: 'audit@partner.com',
        company: 'Audit Corp',
      }),
    });

    const events = auditStore.getAllEvents('partner-program');
    const regEvent = events.find((e) => e.action === 'register_partner');
    expect(regEvent).toBeDefined();
    expect(regEvent?.resource).toBe('partners');
  });

  it('rejects invalid JSON body', async () => {
    const app = createTestApp();
    const token = await makeJwt();

    const res = await app.request('/api/v1/partners/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: 'not json',
    });

    expect(res.status).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════
// GET /api/v1/partners/me
// ═══════════════════════════════════════════════════════════════════

describe('GET /api/v1/partners/me', () => {
  it('returns partner profile', async () => {
    seedPartner();
    const app = createTestApp();
    const token = await makeJwt({ sub: 'partner-001' });

    const res = await app.request('/api/v1/partners/me', {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as PartnerBody;
    expect(body.success).toBe(true);
    expect(body.data.name).toBe('Test Partner');
    expect(body.data.company).toBe('Partner Corp');
    expect(body.data.tier).toBe('gold');
    expect(body.data.revenueSharePct).toBe(20);
  });

  it('returns 404 for non-existent partner', async () => {
    const app = createTestApp();
    const token = await makeJwt({ sub: 'nonexistent' });

    const res = await app.request('/api/v1/partners/me', {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(404);
  });

  it('returns 401 when unauthenticated', async () => {
    const app = createTestApp();

    const res = await app.request('/api/v1/partners/me', {
      method: 'GET',
    });

    expect(res.status).toBe(401);
  });

  it('includes all expected profile fields', async () => {
    seedPartner();
    const app = createTestApp();
    const token = await makeJwt({ sub: 'partner-001' });

    const res = await app.request('/api/v1/partners/me', {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });

    const body = (await res.json()) as PartnerBody;
    expect(body.data).toHaveProperty('id');
    expect(body.data).toHaveProperty('name');
    expect(body.data).toHaveProperty('email');
    expect(body.data).toHaveProperty('company');
    expect(body.data).toHaveProperty('tier');
    expect(body.data).toHaveProperty('status');
    expect(body.data).toHaveProperty('revenueSharePct');
    expect(body.data).toHaveProperty('createdAt');
    expect(body.data).toHaveProperty('updatedAt');
  });
});

// ═══════════════════════════════════════════════════════════════════
// PUT /api/v1/partners/me
// ═══════════════════════════════════════════════════════════════════

describe('PUT /api/v1/partners/me', () => {
  it('updates partner name', async () => {
    seedPartner();
    const app = createTestApp();
    const token = await makeJwt({ sub: 'partner-001' });

    const res = await app.request('/api/v1/partners/me', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: 'Updated Name' }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as PartnerBody;
    expect(body.data.name).toBe('Updated Name');
  });

  it('updates partner company', async () => {
    seedPartner();
    const app = createTestApp();
    const token = await makeJwt({ sub: 'partner-001' });

    const res = await app.request('/api/v1/partners/me', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ company: 'New Corp' }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as PartnerBody;
    expect(body.data.company).toBe('New Corp');
  });

  it('returns 404 for non-existent partner', async () => {
    const app = createTestApp();
    const token = await makeJwt({ sub: 'nonexistent' });

    const res = await app.request('/api/v1/partners/me', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: 'Updated' }),
    });

    expect(res.status).toBe(404);
  });

  it('returns 401 when unauthenticated', async () => {
    const app = createTestApp();

    const res = await app.request('/api/v1/partners/me', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Updated' }),
    });

    expect(res.status).toBe(401);
  });

  it('audit-logs the update', async () => {
    seedPartner();
    const app = createTestApp();
    const token = await makeJwt({ sub: 'partner-001' });

    await app.request('/api/v1/partners/me', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: 'Audit Update' }),
    });

    const events = auditStore.getAllEvents('partner-program');
    const updateEvent = events.find((e) => e.action === 'update_partner_profile');
    expect(updateEvent).toBeDefined();
    expect(updateEvent?.resource).toBe('partners');
  });

  it('rejects empty name', async () => {
    seedPartner();
    const app = createTestApp();
    const token = await makeJwt({ sub: 'partner-001' });

    const res = await app.request('/api/v1/partners/me', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: '' }),
    });

    expect(res.status).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════
// GET /api/v1/partners/earnings
// ═══════════════════════════════════════════════════════════════════

describe('GET /api/v1/partners/earnings', () => {
  it('returns earnings summary', async () => {
    seedPartner();
    const app = createTestApp();
    const token = await makeJwt({ sub: 'partner-001' });

    const res = await app.request('/api/v1/partners/earnings', {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as PartnerBody;
    expect(body.success).toBe(true);
    expect(body.data).toHaveProperty('totalCents');
    expect(body.data).toHaveProperty('pendingCents');
    expect(body.data).toHaveProperty('paidCents');
    expect(body.data).toHaveProperty('currency');
  });

  it('returns 404 for non-existent partner', async () => {
    const app = createTestApp();
    const token = await makeJwt({ sub: 'nonexistent' });

    const res = await app.request('/api/v1/partners/earnings', {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(404);
  });

  it('returns 401 when unauthenticated', async () => {
    const app = createTestApp();

    const res = await app.request('/api/v1/partners/earnings', {
      method: 'GET',
    });

    expect(res.status).toBe(401);
  });

  it('earnings values are numeric', async () => {
    seedPartner();
    const app = createTestApp();
    const token = await makeJwt({ sub: 'partner-001' });

    const res = await app.request('/api/v1/partners/earnings', {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });

    const body = (await res.json()) as PartnerBody;
    expect(typeof body.data.totalCents).toBe('number');
    expect(typeof body.data.pendingCents).toBe('number');
    expect(typeof body.data.paidCents).toBe('number');
  });
});

// ═══════════════════════════════════════════════════════════════════
// GET /api/v1/partners/payouts
// ═══════════════════════════════════════════════════════════════════

describe('GET /api/v1/partners/payouts', () => {
  it('returns payout history', async () => {
    seedPartner();
    seedPayout({ partnerId: 'partner-001', status: 'paid' });
    seedPayout({ partnerId: 'partner-001', status: 'pending', paidAt: null });
    const app = createTestApp();
    const token = await makeJwt({ sub: 'partner-001' });

    const res = await app.request('/api/v1/partners/payouts', {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as PartnerBody;
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBe(2);
  });

  it('returns empty array when no payouts', async () => {
    seedPartner();
    const app = createTestApp();
    const token = await makeJwt({ sub: 'partner-001' });

    const res = await app.request('/api/v1/partners/payouts', {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as PartnerBody;
    expect(body.data).toEqual([]);
  });

  it('returns 404 for non-existent partner', async () => {
    const app = createTestApp();
    const token = await makeJwt({ sub: 'nonexistent' });

    const res = await app.request('/api/v1/partners/payouts', {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(404);
  });

  it('returns 401 when unauthenticated', async () => {
    const app = createTestApp();

    const res = await app.request('/api/v1/partners/payouts', {
      method: 'GET',
    });

    expect(res.status).toBe(401);
  });

  it('payout items have expected fields', async () => {
    seedPartner();
    seedPayout({ partnerId: 'partner-001' });
    const app = createTestApp();
    const token = await makeJwt({ sub: 'partner-001' });

    const res = await app.request('/api/v1/partners/payouts', {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });

    const body = (await res.json()) as PartnerBody;
    const payout = body.data[0];
    expect(payout).toHaveProperty('id');
    expect(payout).toHaveProperty('amountCents');
    expect(payout).toHaveProperty('currency');
    expect(payout).toHaveProperty('periodStart');
    expect(payout).toHaveProperty('periodEnd');
    expect(payout).toHaveProperty('status');
  });

  it('does not expose partnerId in payout response', async () => {
    seedPartner();
    seedPayout({ partnerId: 'partner-001' });
    const app = createTestApp();
    const token = await makeJwt({ sub: 'partner-001' });

    const res = await app.request('/api/v1/partners/payouts', {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });

    const body = (await res.json()) as PartnerBody;
    const payout = body.data[0];
    expect(payout).not.toHaveProperty('partnerId');
  });
});
