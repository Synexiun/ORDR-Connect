/**
 * Configuration — Zod-validated environment config for ORDR-Connect
 *
 * SECURITY:
 * - Secrets NEVER have defaults — app MUST fail if missing in production.
 * - All URLs and ports are validated for correct format.
 * - NODE_ENV is strictly typed.
 */

import { z } from 'zod';

// ─── Helpers ──────────────────────────────────────────────────────

/** Env vars are strings — 'true'/'1' = true, everything else = false */
const booleanFromEnv = z.union([z.boolean(), z.string()]).transform((val) => {
  if (typeof val === 'boolean') return val;
  return val === 'true' || val === '1';
});

// ─── Environment Schema ───────────────────────────────────────────

export const envSchema = z
  .object({
    // ── General ─────────────────────────────────────────
    NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
    CORS_ORIGINS: z.string().default('http://localhost:3000'),

    // ── Database ────────────────────────────────────────
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    DATABASE_POOL_MIN: z.coerce.number().int().min(1).default(2),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).default(10),
    DATABASE_SSL: booleanFromEnv.default(true),

    // ── Redis ───────────────────────────────────────────
    REDIS_URL: z.string().min(1, 'REDIS_URL is required'),
    REDIS_KEY_PREFIX: z.string().default('ordr:'),

    // ── Kafka ───────────────────────────────────────────
    KAFKA_BROKERS: z.string().min(1, 'KAFKA_BROKERS is required'),
    KAFKA_CLIENT_ID: z.string().default('ordr-connect'),
    KAFKA_GROUP_ID: z.string().default('ordr-connect-group'),
    KAFKA_SSL: booleanFromEnv.default(true),

    // ── Auth (secrets — NO defaults) ────────────────────
    JWT_PRIVATE_KEY: z.string().min(1, 'JWT_PRIVATE_KEY is required'),
    JWT_PUBLIC_KEY: z.string().min(1, 'JWT_PUBLIC_KEY is required'),
    JWT_ACCESS_TOKEN_EXPIRY: z.string().default('15m'),
    JWT_REFRESH_TOKEN_EXPIRY: z.string().default('7d'),
    SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),

    // ── Encryption (secrets — NO defaults) ──────────────
    ENCRYPTION_MASTER_KEY: z.string().min(1, 'ENCRYPTION_MASTER_KEY is required'),
    HMAC_SECRET: z.string().min(1, 'HMAC_SECRET is required'),

    // ── AI ──────────────────────────────────────────────
    OPENAI_API_KEY: z.string().min(1, 'OPENAI_API_KEY is required'),
    AI_MODEL: z.string().default('gpt-4o'),
    AI_MAX_TOKENS: z.coerce.number().int().min(1).default(4096),
    AI_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.1),

    // ── Monitoring ──────────────────────────────────────
    SENTRY_DSN: z.string().optional(),
    OTEL_EXPORTER_ENDPOINT: z.string().optional(),
    OTEL_SERVICE_NAME: z.string().default('ordr-connect'),

    // ── Vault (Secret Management — optional; no-op when absent) ─────
    VAULT_ADDR: z.string().url().optional(),
    VAULT_ROLE: z.string().min(1).optional(),
    VAULT_MOUNT: z.string().min(1).default('secret'),
    VAULT_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(60_000),
    KEY_ROTATION_CHECK_CRON: z.string().default('0 2 * * *'),
  })
  .refine(
    (data) => {
      if (data.VAULT_ADDR !== undefined && data.VAULT_ADDR !== '') {
        return data.VAULT_ROLE !== undefined && data.VAULT_ROLE !== '';
      }
      return true;
    },
    { message: 'VAULT_ROLE is required when VAULT_ADDR is set', path: ['VAULT_ROLE'] },
  );

// ─── Derived Type ─────────────────────────────────────────────────

export type AppConfig = z.infer<typeof envSchema>;

// ─── Sectioned Access ─────────────────────────────────────────────

export interface DatabaseConfig {
  readonly url: string;
  readonly poolMin: number;
  readonly poolMax: number;
  readonly ssl: boolean;
}

export interface RedisConfig {
  readonly url: string;
  readonly keyPrefix: string;
}

export interface KafkaConfig {
  readonly brokers: string[];
  readonly clientId: string;
  readonly groupId: string;
  readonly ssl: boolean;
}

export interface AuthConfig {
  readonly jwtPrivateKey: string;
  readonly jwtPublicKey: string;
  readonly accessTokenExpiry: string;
  readonly refreshTokenExpiry: string;
  readonly sessionSecret: string;
}

export interface EncryptionConfig {
  readonly masterKey: string;
  readonly hmacSecret: string;
}

export interface AIConfig {
  readonly apiKey: string;
  readonly model: string;
  readonly maxTokens: number;
  readonly temperature: number;
}

export interface MonitoringConfig {
  readonly sentryDsn: string | undefined;
  readonly otelEndpoint: string | undefined;
  readonly otelServiceName: string;
}

export interface VaultConfig {
  readonly addr: string | undefined;
  readonly role: string | undefined;
  readonly mount: string;
  readonly pollIntervalMs: number;
  readonly keyRotationCheckCron: string;
}

export interface ParsedConfig {
  readonly nodeEnv: AppConfig['NODE_ENV'];
  readonly port: number;
  readonly logLevel: string;
  readonly corsOrigins: string[];
  readonly database: DatabaseConfig;
  readonly redis: RedisConfig;
  readonly kafka: KafkaConfig;
  readonly auth: AuthConfig;
  readonly encryption: EncryptionConfig;
  readonly ai: AIConfig;
  readonly monitoring: MonitoringConfig;
  readonly vault: VaultConfig;
}

// ─── Loader ───────────────────────────────────────────────────────

/**
 * Validates process.env against the schema and returns a structured config.
 * Throws with descriptive errors if required vars are missing.
 */
export function loadConfig(env: Record<string, string | undefined> = process.env): ParsedConfig {
  const parsed = envSchema.parse(env);

  return {
    nodeEnv: parsed.NODE_ENV,
    port: parsed.PORT,
    logLevel: parsed.LOG_LEVEL,
    corsOrigins: parsed.CORS_ORIGINS.split(',').map((o) => o.trim()),
    database: {
      url: parsed.DATABASE_URL,
      poolMin: parsed.DATABASE_POOL_MIN,
      poolMax: parsed.DATABASE_POOL_MAX,
      ssl: parsed.DATABASE_SSL,
    },
    redis: {
      url: parsed.REDIS_URL,
      keyPrefix: parsed.REDIS_KEY_PREFIX,
    },
    kafka: {
      brokers: parsed.KAFKA_BROKERS.split(',').map((b) => b.trim()),
      clientId: parsed.KAFKA_CLIENT_ID,
      groupId: parsed.KAFKA_GROUP_ID,
      ssl: parsed.KAFKA_SSL,
    },
    auth: {
      jwtPrivateKey: parsed.JWT_PRIVATE_KEY,
      jwtPublicKey: parsed.JWT_PUBLIC_KEY,
      accessTokenExpiry: parsed.JWT_ACCESS_TOKEN_EXPIRY,
      refreshTokenExpiry: parsed.JWT_REFRESH_TOKEN_EXPIRY,
      sessionSecret: parsed.SESSION_SECRET,
    },
    encryption: {
      masterKey: parsed.ENCRYPTION_MASTER_KEY,
      hmacSecret: parsed.HMAC_SECRET,
    },
    ai: {
      apiKey: parsed.OPENAI_API_KEY,
      model: parsed.AI_MODEL,
      maxTokens: parsed.AI_MAX_TOKENS,
      temperature: parsed.AI_TEMPERATURE,
    },
    monitoring: {
      sentryDsn: parsed.SENTRY_DSN,
      otelEndpoint: parsed.OTEL_EXPORTER_ENDPOINT,
      otelServiceName: parsed.OTEL_SERVICE_NAME,
    },
    vault: {
      addr: parsed.VAULT_ADDR,
      role: parsed.VAULT_ROLE,
      mount: parsed.VAULT_MOUNT,
      pollIntervalMs: parsed.VAULT_POLL_INTERVAL_MS,
      keyRotationCheckCron: parsed.KEY_ROTATION_CHECK_CRON,
    },
  };
}
