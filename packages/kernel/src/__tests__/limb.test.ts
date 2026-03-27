import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Limb } from '../limb.js';
import { KillSwitchActivatedError } from '../kill-switch.js';
import type { LimbEnv } from '../limb.js';
import { LimbIdentity } from '../identity.js';

// We mock fetch to isolate the Limb from network calls
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function makeRegisterResponse() {
  return {
    limb_id: 'test-limb-001',
    certificate: 'mock-cert',
    issued_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString(),
  };
}

async function makeEnv(): Promise<LimbEnv> {
  const { privateKeyHex } = await LimbIdentity.generate('test-limb-001');
  return {
    privateKeyHex,
    coreUrl: 'https://core.synexiun.internal:8100',
    adminToken: 'test-admin-token',
    limbId: 'test-limb-001',
    heartbeatIntervalMs: 60_000, // long interval — won't fire during unit tests
  };
}

describe('Limb', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Default: registration succeeds, diode accepts
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify(makeRegisterResponse())),
      json: () => Promise.resolve({ accepted: true }),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    mockFetch.mockReset();
  });

  it('boot() registers with Core and returns a Limb', async () => {
    const env = await makeEnv();
    const limb = await Limb.boot(env);
    expect(limb.isRegistered).toBe(true);
    expect(limb.certificate).not.toBeNull();
    limb.shutdown();
  });

  it('boot() posts to the registration endpoint', async () => {
    const env = await makeEnv();
    await Limb.boot(env).then((l) => {
      l.shutdown();
    });
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/limbs/test-limb-001/register'),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('boot() uses admin token in Authorization header', async () => {
    const env = await makeEnv();
    await Limb.boot(env).then((l) => {
      l.shutdown();
    });
    const [, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect((opts.headers as Record<string, string>)['Authorization']).toBe(
      'Bearer test-admin-token',
    );
  });

  it('heartbeat is running after boot()', async () => {
    const env = await makeEnv();
    const limb = await Limb.boot(env);
    expect(limb.heartbeat.isRunning).toBe(true);
    limb.shutdown();
  });

  it('shutdown() stops the heartbeat', async () => {
    const env = await makeEnv();
    const limb = await Limb.boot(env);
    limb.shutdown();
    expect(limb.heartbeat.isRunning).toBe(false);
  });

  it('checkAlive() does not throw when active', async () => {
    const env = await makeEnv();
    const limb = await Limb.boot(env);
    expect(() => {
      limb.checkAlive();
    }).not.toThrow();
    limb.shutdown();
  });

  it('terminate() stops heartbeat and activates kill switch', async () => {
    const env = await makeEnv();
    const limb = await Limb.boot(env);
    limb.terminate('core command');
    expect(limb.heartbeat.isRunning).toBe(false);
    expect(limb.killSwitch.isActivated).toBe(true);
    expect(() => {
      limb.checkAlive();
    }).toThrow(KillSwitchActivatedError);
  });

  it('health snapshot reflects live state', async () => {
    const env = await makeEnv();
    const limb = await Limb.boot(env);
    const h = limb.health;
    expect(h.limbId).toBe('test-limb-001');
    expect(h.isRegistered).toBe(true);
    expect(h.isRunning).toBe(true);
    expect(h.killSwitchActivated).toBe(false);
    limb.shutdown();
  });

  it('throws RegistrationError if Core rejects registration', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 403,
      text: () => Promise.resolve('Forbidden'),
    });
    const env = await makeEnv();
    await expect(Limb.boot(env)).rejects.toThrow('Core rejected registration: HTTP 403');
  });

  it('throws if private key hex is invalid', async () => {
    const env = await makeEnv();
    env.privateKeyHex = 'notvalid';
    await expect(Limb.boot(env)).rejects.toThrow('Invalid Ed25519 private key');
  });
});
