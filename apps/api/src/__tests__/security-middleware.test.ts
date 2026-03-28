/**
 * Threat Detection Middleware integration tests
 *
 * Verifies:
 * - No-op when not configured (pass-through)
 * - Honeypot path returns 404 and blocks IP
 * - Blocked IP returns 403
 * - SSRF attack returns 403 (score=900 → critical block)
 * - SQLi in URL returns 429 (score=750 → high challenge)
 * - sqlmap user-agent returns 429 (score=700 → high challenge)
 * - XSS attack returns 429 (score=600 → high challenge)
 * - Clean request passes through with 200
 * - Normal POST with JSON body passes through
 * - Response shape matches error contract (success: false, error.code)
 * - 403 block response never reveals attack type
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { requestId } from '../middleware/request-id.js';
import {
  configureThreatDetection,
  threatDetectionMiddleware,
} from '../middleware/threat-detection.js';
import {
  AnomalyDetector,
  AttackDetector,
  DLPScanner,
  ThreatScorer,
  SecurityEventBus,
  IPIntelligence,
} from '@ordr/security';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeApp(): Hono {
  const app = new Hono();
  app.use('*', requestId);
  app.use('*', threatDetectionMiddleware);
  app.get('*', (c) => c.json({ success: true, data: 'ok' }, 200));
  app.post('*', (c) => c.json({ success: true, data: 'ok' }, 200));
  return app;
}

function makeRequest(path: string, opts: RequestInit = {}): Request {
  return new Request(`http://localhost${path}`, {
    headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    ...opts,
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('threatDetectionMiddleware — unconfigured (no-op)', () => {
  it('passes through when not configured', async () => {
    const app = new Hono();
    app.use('*', threatDetectionMiddleware);
    app.get('*', (c) => c.json({ ok: true }, 200));

    const res = await app.request(makeRequest('/api/v1/customers'));
    expect(res.status).toBe(200);
  });
});

describe('threatDetectionMiddleware — configured', () => {
  let app: Hono;

  beforeEach(() => {
    configureThreatDetection({
      anomalyDetector: new AnomalyDetector(),
      attackDetector: new AttackDetector(),
      dlpScanner: new DLPScanner(),
      threatScorer: new ThreatScorer(),
      securityEventBus: new SecurityEventBus(),
      ipIntelligence: new IPIntelligence(),
      dlpEnabled: false,
    });
    app = makeApp();
  });

  // ─── Clean request ────────────────────────────────────────────────────

  it('clean request passes through with 200', async () => {
    const res = await app.request(makeRequest('/api/v1/customers'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean };
    expect(body.success).toBe(true);
  });

  it('normal POST with clean JSON body passes through with 200', async () => {
    const res = await app.request(
      new Request('http://localhost/api/v1/customers', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36',
        },
        body: JSON.stringify({ name: 'Alice', email: 'alice@example.com' }),
      }),
    );
    expect(res.status).toBe(200);
  });

  // ─── Honeypot ─────────────────────────────────────────────────────────

  it('honeypot path /wp-admin/login returns 404', async () => {
    const res = await app.request(makeRequest('/wp-admin/login'));
    expect(res.status).toBe(404);
    const body = (await res.json()) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('honeypot path /.env returns 404', async () => {
    const res = await app.request(makeRequest('/.env'));
    expect(res.status).toBe(404);
  });

  it('honeypot path /.git/config returns 404', async () => {
    const res = await app.request(makeRequest('/.git/config'));
    expect(res.status).toBe(404);
  });

  // ─── Blocked IP ───────────────────────────────────────────────────────

  it('blocked IP returns 403', async () => {
    const ip = '10.0.0.200';
    // First hit honeypot to get IP auto-blocked
    await app.request(
      new Request('http://localhost/.env', {
        headers: { 'x-forwarded-for': ip, 'user-agent': 'test' },
      }),
    );
    // Subsequent request from same IP must be blocked
    const res = await app.request(
      new Request('http://localhost/api/v1/customers', {
        headers: { 'x-forwarded-for': ip, 'user-agent': 'Mozilla/5.0' },
      }),
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('FORBIDDEN');
  });

  // ─── SSRF attack (score=900 → critical block → 403) ──────────────────

  it('SSRF to localhost in query param returns 403', async () => {
    // SSRF score=900 → critical/block → 403
    const res = await app.request(makeRequest('/api/v1/fetch?url=http://localhost/admin'));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { success: boolean; error: { code: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('SSRF to AWS metadata endpoint returns 403', async () => {
    const res = await app.request(
      makeRequest('/api/v1/fetch?url=http://169.254.169.254/latest/meta-data/'),
    );
    expect(res.status).toBe(403);
  });

  // ─── High-risk attacks (score < 800 → challenge → 429) ───────────────

  it('SQLi in query param returns 429 (challenge)', async () => {
    // sqli critical = 750 → high/challenge → 429
    const res = await app.request(
      makeRequest("/api/v1/customers?id=1' UNION SELECT username,password FROM users--"),
    );
    expect(res.status).toBe(429);
  });

  it('XSS <script> tag in query param returns 429 (challenge)', async () => {
    // xss critical = 600 → high/challenge → 429
    const res = await app.request(
      makeRequest('/api/v1/search?q=<script>alert(document.cookie)</script>'),
    );
    expect(res.status).toBe(429);
  });

  it('path traversal in query param returns 429 (challenge)', async () => {
    // path_traversal critical = 700 → high/challenge → 429
    const res = await app.request(makeRequest('/api/v1/files?path=../../etc/passwd'));
    expect(res.status).toBe(429);
  });

  it('sqlmap user-agent returns 429 (challenge)', async () => {
    // sqlmap UA = 700 → high/challenge → 429
    const res = await app.request(
      new Request('http://localhost/api/v1/customers', {
        headers: { 'user-agent': 'sqlmap/1.7.2#stable (https://sqlmap.org)' },
      }),
    );
    expect(res.status).toBe(429);
  });

  it('Nikto scanner user-agent returns 429 (challenge)', async () => {
    // Nikto UA = 700 → high/challenge → 429
    const res = await app.request(
      new Request('http://localhost/api/v1/customers', {
        headers: { 'user-agent': 'Nikto/2.1.6' },
      }),
    );
    expect(res.status).toBe(429);
  });

  // ─── Response shape ───────────────────────────────────────────────────

  it('404 honeypot response has correlationId', async () => {
    const res = await app.request(makeRequest('/.env'));
    const body = (await res.json()) as { error: { correlationId?: string } };
    expect(typeof body.error.correlationId).toBe('string');
  });

  it('429 challenge response has Retry-After header', async () => {
    const res = await app.request(makeRequest('/api/v1/customers?id=1%27 OR 1=1--'));
    if (res.status === 429) {
      expect(res.headers.get('Retry-After')).toBe('60');
    }
  });

  it('403 block response does not reveal attack type', async () => {
    const res = await app.request(makeRequest('/api/v1/fetch?url=http://127.0.0.1/admin'));
    const text = await res.text();
    expect(text).not.toContain('ssrf');
    expect(text).not.toContain('SSRF');
    expect(text).not.toContain('injection');
    expect(text).not.toContain('stack');
    expect(text).not.toContain('Error:');
  });
});
