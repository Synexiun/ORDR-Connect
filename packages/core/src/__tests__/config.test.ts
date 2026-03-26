import { describe, it, expect } from 'vitest';
import { ZodError } from 'zod';
import { loadConfig, envSchema } from '../config.js';

// ─── Helpers ──────────────────────────────────────────────────────

/** Minimal valid env — every required secret present */
function validEnv(): Record<string, string> {
  return {
    NODE_ENV: 'test',
    PORT: '4000',
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/ordr_test',
    REDIS_URL: 'redis://localhost:6379',
    KAFKA_BROKERS: 'localhost:9092',
    JWT_PRIVATE_KEY: 'test-private-key-content',
    JWT_PUBLIC_KEY: 'test-public-key-content',
    SESSION_SECRET: 'a-session-secret-that-is-at-least-32-characters-long',
    ENCRYPTION_MASTER_KEY: 'test-master-key',
    HMAC_SECRET: 'test-hmac-secret',
    OPENAI_API_KEY: 'sk-test-key-12345',
  };
}

// ─── Rejects Missing Required Vars ────────────────────────────────

describe('config validation — missing required vars', () => {
  it('rejects missing DATABASE_URL', () => {
    const env = validEnv();
    delete env['DATABASE_URL'];
    expect(() => loadConfig(env)).toThrow(ZodError);
  });

  it('rejects missing REDIS_URL', () => {
    const env = validEnv();
    delete env['REDIS_URL'];
    expect(() => loadConfig(env)).toThrow(ZodError);
  });

  it('rejects missing KAFKA_BROKERS', () => {
    const env = validEnv();
    delete env['KAFKA_BROKERS'];
    expect(() => loadConfig(env)).toThrow(ZodError);
  });

  it('rejects missing JWT_PRIVATE_KEY', () => {
    const env = validEnv();
    delete env['JWT_PRIVATE_KEY'];
    expect(() => loadConfig(env)).toThrow(ZodError);
  });

  it('rejects missing JWT_PUBLIC_KEY', () => {
    const env = validEnv();
    delete env['JWT_PUBLIC_KEY'];
    expect(() => loadConfig(env)).toThrow(ZodError);
  });

  it('rejects missing SESSION_SECRET', () => {
    const env = validEnv();
    delete env['SESSION_SECRET'];
    expect(() => loadConfig(env)).toThrow(ZodError);
  });

  it('rejects missing ENCRYPTION_MASTER_KEY', () => {
    const env = validEnv();
    delete env['ENCRYPTION_MASTER_KEY'];
    expect(() => loadConfig(env)).toThrow(ZodError);
  });

  it('rejects missing HMAC_SECRET', () => {
    const env = validEnv();
    delete env['HMAC_SECRET'];
    expect(() => loadConfig(env)).toThrow(ZodError);
  });

  it('rejects missing OPENAI_API_KEY', () => {
    const env = validEnv();
    delete env['OPENAI_API_KEY'];
    expect(() => loadConfig(env)).toThrow(ZodError);
  });

  it('rejects SESSION_SECRET shorter than 32 chars', () => {
    const env = validEnv();
    env['SESSION_SECRET'] = 'too-short';
    expect(() => loadConfig(env)).toThrow(ZodError);
  });
});

// ─── Rejects Invalid Types ────────────────────────────────────────

describe('config validation — invalid types', () => {
  it('rejects invalid NODE_ENV', () => {
    const env = validEnv();
    env['NODE_ENV'] = 'invalid_env';
    expect(() => loadConfig(env)).toThrow(ZodError);
  });

  it('rejects invalid PORT (non-numeric)', () => {
    const env = validEnv();
    env['PORT'] = 'not-a-number';
    expect(() => loadConfig(env)).toThrow(ZodError);
  });

  it('rejects PORT out of range', () => {
    const env = validEnv();
    env['PORT'] = '99999';
    expect(() => loadConfig(env)).toThrow(ZodError);
  });

  it('rejects PORT = 0', () => {
    const env = validEnv();
    env['PORT'] = '0';
    expect(() => loadConfig(env)).toThrow(ZodError);
  });

  it('rejects invalid LOG_LEVEL', () => {
    const env = validEnv();
    env['LOG_LEVEL'] = 'verbose';
    expect(() => loadConfig(env)).toThrow(ZodError);
  });

  it('rejects empty DATABASE_URL', () => {
    const env = validEnv();
    env['DATABASE_URL'] = '';
    expect(() => loadConfig(env)).toThrow(ZodError);
  });
});

// ─── Loads Valid Config ───────────────────────────────────────────

describe('loadConfig — valid input', () => {
  it('parses all required fields correctly', () => {
    const config = loadConfig(validEnv());

    expect(config.nodeEnv).toBe('test');
    expect(config.port).toBe(4000);
    expect(config.database.url).toBe('postgresql://user:pass@localhost:5432/ordr_test');
    expect(config.redis.url).toBe('redis://localhost:6379');
    expect(config.kafka.brokers).toEqual(['localhost:9092']);
    expect(config.auth.jwtPrivateKey).toBe('test-private-key-content');
    expect(config.auth.jwtPublicKey).toBe('test-public-key-content');
    expect(config.encryption.masterKey).toBe('test-master-key');
    expect(config.encryption.hmacSecret).toBe('test-hmac-secret');
    expect(config.ai.apiKey).toBe('sk-test-key-12345');
  });

  it('applies correct defaults', () => {
    const config = loadConfig(validEnv());

    expect(config.logLevel).toBe('info');
    expect(config.database.poolMin).toBe(2);
    expect(config.database.poolMax).toBe(10);
    expect(config.database.ssl).toBe(true);
    expect(config.redis.keyPrefix).toBe('ordr:');
    expect(config.kafka.clientId).toBe('ordr-connect');
    expect(config.kafka.groupId).toBe('ordr-connect-group');
    expect(config.kafka.ssl).toBe(true);
    expect(config.auth.accessTokenExpiry).toBe('15m');
    expect(config.auth.refreshTokenExpiry).toBe('7d');
    expect(config.ai.model).toBe('gpt-4o');
    expect(config.ai.maxTokens).toBe(4096);
    expect(config.ai.temperature).toBe(0.1);
    expect(config.monitoring.otelServiceName).toBe('ordr-connect');
  });

  it('parses comma-separated CORS_ORIGINS', () => {
    const env = { ...validEnv(), CORS_ORIGINS: 'https://app.ordr.io, https://admin.ordr.io' };
    const config = loadConfig(env);

    expect(config.corsOrigins).toEqual(['https://app.ordr.io', 'https://admin.ordr.io']);
  });

  it('parses comma-separated KAFKA_BROKERS', () => {
    const env = { ...validEnv(), KAFKA_BROKERS: 'broker1:9092,broker2:9092,broker3:9092' };
    const config = loadConfig(env);

    expect(config.kafka.brokers).toEqual(['broker1:9092', 'broker2:9092', 'broker3:9092']);
  });

  it('optional monitoring fields can be omitted', () => {
    const config = loadConfig(validEnv());

    expect(config.monitoring.sentryDsn).toBeUndefined();
    expect(config.monitoring.otelEndpoint).toBeUndefined();
  });

  it('overrides defaults when provided', () => {
    const env = {
      ...validEnv(),
      PORT: '8080',
      DATABASE_POOL_MIN: '5',
      DATABASE_POOL_MAX: '50',
      DATABASE_SSL: 'false',
      AI_MODEL: 'gpt-4-turbo',
      AI_MAX_TOKENS: '8192',
      AI_TEMPERATURE: '0.5',
    };
    const config = loadConfig(env);

    expect(config.port).toBe(8080);
    expect(config.database.poolMin).toBe(5);
    expect(config.database.poolMax).toBe(50);
    expect(config.database.ssl).toBe(false);
    expect(config.ai.model).toBe('gpt-4-turbo');
    expect(config.ai.maxTokens).toBe(8192);
    expect(config.ai.temperature).toBe(0.5);
  });
});

// ─── Schema Object ────────────────────────────────────────────────

describe('envSchema', () => {
  it('is a Zod object schema', () => {
    expect(envSchema).toBeDefined();
    expect(typeof envSchema.parse).toBe('function');
    expect(typeof envSchema.safeParse).toBe('function');
  });

  it('safeParse returns success false for invalid input', () => {
    const result = envSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('safeParse returns success true for valid input', () => {
    const result = envSchema.safeParse(validEnv());
    expect(result.success).toBe(true);
  });
});
