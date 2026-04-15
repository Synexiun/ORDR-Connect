import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RealWorkOSClient } from '../sso.js';

// ─── Mock fetch ──────────────────────────────────────────────────────────────

const originalFetch = globalThis.fetch;

function mockFetch(response: { status: number; body: unknown }) {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: response.status >= 200 && response.status < 300,
    status: response.status,
    json: () => Promise.resolve(response.body),
    text: () => Promise.resolve(JSON.stringify(response.body)),
  });
}

beforeEach(() => {
  globalThis.fetch = vi.fn();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('RealWorkOSClient', () => {
  it('constructor throws if apiKey is empty', () => {
    expect(() => new RealWorkOSClient('')).toThrow('WorkOS API key is required');
  });

  it('getAuthorizationUrl builds correct URL', async () => {
    const client = new RealWorkOSClient('wos_test_key');
    const url = await client.getAuthorizationUrl({
      connectionId: 'conn_123',
      redirectUri: 'https://app.test.com/callback',
      state: 'state_abc',
      clientId: 'client_456',
    });

    const parsed = new URL(url);
    expect(parsed.origin).toBe('https://api.workos.com');
    expect(parsed.pathname).toBe('/sso/authorize');
    expect(parsed.searchParams.get('connection')).toBe('conn_123');
    expect(parsed.searchParams.get('client_id')).toBe('client_456');
    expect(parsed.searchParams.get('redirect_uri')).toBe('https://app.test.com/callback');
    expect(parsed.searchParams.get('state')).toBe('state_abc');
    expect(parsed.searchParams.get('response_type')).toBe('code');
  });

  it('getAuthorizationUrl uses custom baseUrl', async () => {
    const client = new RealWorkOSClient('key', 'https://custom.workos.dev');
    const url = await client.getAuthorizationUrl({
      connectionId: 'conn_1',
      redirectUri: 'https://app.test.com/cb',
      state: 's',
      clientId: 'c',
    });
    expect(url).toContain('https://custom.workos.dev/sso/authorize');
  });

  it('getProfileByCode returns mapped profile on success', async () => {
    mockFetch({
      status: 200,
      body: {
        profile: {
          id: 'prof_1',
          email: 'user@example.com',
          first_name: 'Jane',
          last_name: 'Doe',
          idp_id: 'idp_123',
          connection_type: 'saml',
          raw_attributes: { groups: ['admins'] },
        },
      },
    });

    const client = new RealWorkOSClient('wos_key');
    const profile = await client.getProfileByCode('auth_code_xyz');

    expect(profile.id).toBe('prof_1');
    expect(profile.email).toBe('user@example.com');
    expect(profile.firstName).toBe('Jane');
    expect(profile.lastName).toBe('Doe');
    expect(profile.idpId).toBe('idp_123');
    expect(profile.connectionType).toBe('saml');
    expect(profile.rawAttributes).toEqual({ groups: ['admins'] });

    // Verify fetch was called with correct params
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://api.workos.com/sso/token',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  });

  it('getProfileByCode throws on non-OK response', async () => {
    mockFetch({ status: 401, body: { message: 'Unauthorized' } });

    const client = new RealWorkOSClient('bad_key');
    await expect(client.getProfileByCode('invalid_code')).rejects.toThrow(
      'WorkOS SSO token exchange failed (401)',
    );
  });

  it('getProfileByCode throws on 500 error', async () => {
    mockFetch({ status: 500, body: 'Internal Server Error' });

    const client = new RealWorkOSClient('key');
    await expect(client.getProfileByCode('code')).rejects.toThrow(
      'WorkOS SSO token exchange failed (500)',
    );
  });
});
