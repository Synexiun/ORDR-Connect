import { describe, it, expect, beforeEach } from 'vitest';
import {
  SSOManager,
  InMemorySSOClient,
  InMemorySSOConnectionStore,
} from '../sso.js';
import type { SSOManagerConfig, SSOConnection } from '../sso.js';

// ─── Test Helpers ──────────────────────────────────────────────────

const TEST_CONFIG: SSOManagerConfig = {
  apiKey: 'test-api-key',
  clientId: 'test-client-id',
  redirectUri: 'https://app.test.com/sso/callback',
};

const STATE_ENCRYPTION_KEY = 'a'.repeat(32); // 32-byte key for testing

function createTestSetup() {
  const client = new InMemorySSOClient();
  const connectionStore = new InMemorySSOConnectionStore();
  const manager = new SSOManager(
    TEST_CONFIG,
    client,
    connectionStore,
    STATE_ENCRYPTION_KEY,
  );

  return { client, connectionStore, manager };
}

async function createActiveConnection(
  store: InMemorySSOConnectionStore,
  tenantId: string,
  id: string = 'conn-001',
): Promise<SSOConnection> {
  const connection: SSOConnection = {
    id,
    tenantId,
    name: 'Test SSO',
    type: 'saml',
    provider: 'okta',
    status: 'active',
    enforceSso: false,
    createdAt: new Date(),
  };
  await store.create(connection);
  return connection;
}

// ─── Authorization URL Tests ──────────────────────────────────────

describe('SSOManager.getAuthorizationUrl', () => {
  let setup: ReturnType<typeof createTestSetup>;

  beforeEach(() => {
    setup = createTestSetup();
  });

  it('generates an authorization URL for a valid connection', async () => {
    await createActiveConnection(setup.connectionStore, 'tenant-001');

    const result = await setup.manager.getAuthorizationUrl(
      'tenant-001',
      'conn-001',
      'csrf-state',
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toContain('https://auth.workos.test/sso/authorize');
      expect(result.data).toContain('conn-001');
    }
  });

  it('rejects empty tenant ID', async () => {
    const result = await setup.manager.getAuthorizationUrl('', 'conn-001', 'state');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.statusCode).toBe(400);
    }
  });

  it('rejects empty connection ID', async () => {
    const result = await setup.manager.getAuthorizationUrl('tenant-001', '', 'state');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.statusCode).toBe(400);
    }
  });

  it('returns 404 for non-existent connection', async () => {
    const result = await setup.manager.getAuthorizationUrl(
      'tenant-001',
      'no-such-conn',
      'state',
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.statusCode).toBe(404);
    }
  });

  it('rejects inactive connection', async () => {
    const connection: SSOConnection = {
      id: 'conn-inactive',
      tenantId: 'tenant-001',
      name: 'Inactive SSO',
      type: 'saml',
      provider: 'okta',
      status: 'inactive',
      enforceSso: false,
      createdAt: new Date(),
    };
    await setup.connectionStore.create(connection);

    const result = await setup.manager.getAuthorizationUrl(
      'tenant-001',
      'conn-inactive',
      'state',
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.statusCode).toBe(400);
    }
  });
});

// ─── Callback Handling Tests ──────────────────────────────────────

describe('SSOManager.handleCallback', () => {
  let setup: ReturnType<typeof createTestSetup>;

  beforeEach(() => {
    setup = createTestSetup();
  });

  it('exchanges code for profile via callback', async () => {
    await createActiveConnection(setup.connectionStore, 'tenant-001');

    // Set up expected profile
    setup.client.addProfile('auth-code-123', {
      id: 'sso-user-001',
      email: 'alice@corp.test',
      firstName: 'Alice',
      lastName: 'Smith',
      idpId: 'okta-id-001',
      connectionType: 'saml',
      rawAttributes: { department: 'Engineering' },
    });

    // Get auth URL to create valid state
    const urlResult = await setup.manager.getAuthorizationUrl(
      'tenant-001',
      'conn-001',
      'csrf-token',
    );
    expect(urlResult.success).toBe(true);

    // Extract state from URL
    if (!urlResult.success) return;
    const url = new URL(urlResult.data);
    const state = decodeURIComponent(url.searchParams.get('state') ?? '');

    const result = await setup.manager.handleCallback('auth-code-123', state);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe('alice@corp.test');
      expect(result.data.firstName).toBe('Alice');
      expect(result.data.lastName).toBe('Smith');
      expect(result.data.connectionType).toBe('saml');
    }
  });

  it('rejects empty code', async () => {
    const result = await setup.manager.handleCallback('', 'some-state');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.statusCode).toBe(400);
    }
  });

  it('rejects empty state', async () => {
    const result = await setup.manager.handleCallback('code', '');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.statusCode).toBe(400);
    }
  });

  it('rejects state without pipe separator', async () => {
    const result = await setup.manager.handleCallback('code', 'no-pipe-here');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.statusCode).toBe(400);
    }
  });

  it('rejects tampered state', async () => {
    const result = await setup.manager.handleCallback('code', 'tampered|csrf');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.statusCode).toBe(401);
    }
  });

  it('rejects invalid authorization code', async () => {
    await createActiveConnection(setup.connectionStore, 'tenant-001');

    const urlResult = await setup.manager.getAuthorizationUrl(
      'tenant-001',
      'conn-001',
      'csrf-token',
    );
    expect(urlResult.success).toBe(true);

    if (!urlResult.success) return;
    const url = new URL(urlResult.data);
    const state = decodeURIComponent(url.searchParams.get('state') ?? '');

    const result = await setup.manager.handleCallback('bad-code', state);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.statusCode).toBe(401);
    }
  });
});

// ─── Connection CRUD Tests ────────────────────────────────────────

describe('SSOManager connection management', () => {
  let setup: ReturnType<typeof createTestSetup>;

  beforeEach(() => {
    setup = createTestSetup();
  });

  it('creates an SSO connection', async () => {
    const result = await setup.manager.createSSOConnection('tenant-001', {
      name: 'Okta SAML',
      type: 'saml',
      provider: 'okta',
      metadata: 'https://okta.test/metadata.xml',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('Okta SAML');
      expect(result.data.type).toBe('saml');
      expect(result.data.provider).toBe('okta');
      expect(result.data.status).toBe('validating');
      expect(result.data.tenantId).toBe('tenant-001');
    }
  });

  it('lists connections for a tenant', async () => {
    await setup.manager.createSSOConnection('tenant-001', {
      name: 'SSO 1',
      type: 'saml',
      provider: 'okta',
      metadata: 'meta',
    });
    await setup.manager.createSSOConnection('tenant-001', {
      name: 'SSO 2',
      type: 'oidc',
      provider: 'google',
      metadata: 'meta',
    });

    const result = await setup.manager.getSSOConnections('tenant-001');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(2);
    }
  });

  it('deletes a connection', async () => {
    const created = await setup.manager.createSSOConnection('tenant-001', {
      name: 'To Delete',
      type: 'saml',
      provider: 'okta',
      metadata: 'meta',
    });
    expect(created.success).toBe(true);

    if (!created.success) return;
    const deleteResult = await setup.manager.deleteSSOConnection(
      'tenant-001',
      created.data.id,
    );
    expect(deleteResult.success).toBe(true);

    const listResult = await setup.manager.getSSOConnections('tenant-001');
    expect(listResult.success).toBe(true);
    if (listResult.success) {
      expect(listResult.data).toHaveLength(0);
    }
  });

  it('returns 404 when deleting non-existent connection', async () => {
    const result = await setup.manager.deleteSSOConnection('tenant-001', 'no-such');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.statusCode).toBe(404);
    }
  });

  it('rejects connection creation with empty name', async () => {
    const result = await setup.manager.createSSOConnection('tenant-001', {
      name: '',
      type: 'saml',
      provider: 'okta',
      metadata: 'meta',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.statusCode).toBe(400);
    }
  });

  it('rejects connection creation with empty tenant ID', async () => {
    const result = await setup.manager.createSSOConnection('', {
      name: 'Test',
      type: 'saml',
      provider: 'okta',
      metadata: 'meta',
    });
    expect(result.success).toBe(false);
  });
});

// ─── SSO Enforcement Tests ────────────────────────────────────────

describe('SSOManager.isSSOEnforced', () => {
  let setup: ReturnType<typeof createTestSetup>;

  beforeEach(() => {
    setup = createTestSetup();
  });

  it('returns false when no SSO connection exists', async () => {
    const enforced = await setup.manager.isSSOEnforced('tenant-001');
    expect(enforced).toBe(false);
  });

  it('returns false when connection exists but enforceSso is false', async () => {
    await createActiveConnection(setup.connectionStore, 'tenant-001');
    const enforced = await setup.manager.isSSOEnforced('tenant-001');
    expect(enforced).toBe(false);
  });

  it('returns true when active connection has enforceSso=true', async () => {
    const connection: SSOConnection = {
      id: 'conn-enforced',
      tenantId: 'tenant-001',
      name: 'Enforced SSO',
      type: 'saml',
      provider: 'okta',
      status: 'active',
      enforceSso: true,
      createdAt: new Date(),
    };
    await setup.connectionStore.create(connection);

    const enforced = await setup.manager.isSSOEnforced('tenant-001');
    expect(enforced).toBe(true);
  });
});

// ─── Profile Normalization Tests ──────────────────────────────────

describe('SSO profile normalization', () => {
  it('normalizes profile from WorkOS client response', async () => {
    const setup = createTestSetup();
    await createActiveConnection(setup.connectionStore, 'tenant-001');

    setup.client.addProfile('code-norm', {
      id: 'user-norm',
      email: 'test@corp.test',
      firstName: 'Jane',
      lastName: 'Doe',
      idpId: 'idp-123',
      connectionType: 'oidc',
      rawAttributes: { custom: 'value' },
    });

    const urlResult = await setup.manager.getAuthorizationUrl(
      'tenant-001',
      'conn-001',
      'state',
    );
    expect(urlResult.success).toBe(true);

    if (!urlResult.success) return;
    const url = new URL(urlResult.data);
    const state = decodeURIComponent(url.searchParams.get('state') ?? '');

    const result = await setup.manager.handleCallback('code-norm', state);
    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.data.id).toBe('user-norm');
      expect(result.data.email).toBe('test@corp.test');
      expect(result.data.firstName).toBe('Jane');
      expect(result.data.lastName).toBe('Doe');
      expect(result.data.idpId).toBe('idp-123');
      expect(result.data.connectionType).toBe('oidc');
      expect(result.data.rawAttributes).toEqual({ custom: 'value' });
    }
  });
});
