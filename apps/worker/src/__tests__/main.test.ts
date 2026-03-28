/**
 * Worker main bootstrap tests
 *
 * Verifies:
 * - requireEnv() throws on missing/empty env vars
 * - bootstrap() fails fast when DATABASE_URL is absent (before any I/O)
 */

import { describe, it, expect, afterEach } from 'vitest';
import { requireEnv } from '../main.js';

// ─── requireEnv ─────────────────────────────────────────────────────────────

describe('requireEnv', () => {
  const SAVED: Record<string, string | undefined> = {};

  afterEach(() => {
    // Restore any env vars modified in tests
    for (const [key, val] of Object.entries(SAVED)) {
      if (val === undefined) {
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
        delete process.env[key];
      } else {
        process.env[key] = val;
      }
    }
  });

  it('returns the value when the env var is set', () => {
    SAVED['_TEST_REQUIRE_PRESENT'] = process.env['_TEST_REQUIRE_PRESENT'];
    process.env['_TEST_REQUIRE_PRESENT'] = 'hello-world';
    expect(requireEnv('_TEST_REQUIRE_PRESENT')).toBe('hello-world');
  });

  it('throws when the env var is not set', () => {
    SAVED['_TEST_REQUIRE_ABSENT'] = process.env['_TEST_REQUIRE_ABSENT'];
    delete process.env['_TEST_REQUIRE_ABSENT'];
    expect(() => requireEnv('_TEST_REQUIRE_ABSENT')).toThrow('_TEST_REQUIRE_ABSENT');
  });

  it('throws when the env var is an empty string', () => {
    SAVED['_TEST_REQUIRE_EMPTY'] = process.env['_TEST_REQUIRE_EMPTY'];
    process.env['_TEST_REQUIRE_EMPTY'] = '';
    expect(() => requireEnv('_TEST_REQUIRE_EMPTY')).toThrow('_TEST_REQUIRE_EMPTY');
  });

  it('error message includes the variable name', () => {
    SAVED['_TEST_REQUIRE_NAME'] = process.env['_TEST_REQUIRE_NAME'];
    delete process.env['_TEST_REQUIRE_NAME'];
    expect(() => requireEnv('_TEST_REQUIRE_NAME')).toThrow(
      'Required environment variable "_TEST_REQUIRE_NAME" is not set',
    );
  });
});

// ─── bootstrap() env validation ──────────────────────────────────────────────
// bootstrap() must throw BEFORE attempting any network I/O when required
// env vars are absent. This keeps the feedback loop fast and unambiguous.

describe('bootstrap — env validation', () => {
  const SAVED: Record<string, string | undefined> = {};

  afterEach(() => {
    for (const [key, val] of Object.entries(SAVED)) {
      if (val === undefined) {
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
        delete process.env[key];
      } else {
        process.env[key] = val;
      }
    }
  });

  it('rejects with an error mentioning DATABASE_URL when it is not set', async () => {
    SAVED['DATABASE_URL'] = process.env['DATABASE_URL'];
    delete process.env['DATABASE_URL'];

    // Re-import to get a fresh reference (module may be cached, but the
    // exported function reads process.env at call time, not import time).
    const { bootstrap } = await import('../main.js');
    await expect(bootstrap()).rejects.toThrow('DATABASE_URL');
  });

  it('rejects immediately — error contains the variable name', async () => {
    SAVED['DATABASE_URL'] = process.env['DATABASE_URL'];
    delete process.env['DATABASE_URL'];

    const { bootstrap } = await import('../main.js');
    const err = await bootstrap().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain('DATABASE_URL');
  });
});
