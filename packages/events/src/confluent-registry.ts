/**
 * Confluent Schema Registry client
 *
 * Registers JSON Schema versions for all ORDR-Connect event types with the
 * Confluent Schema Registry REST API. Producers stamp `x-schema-id` on every
 * Kafka message so consumers (and audit replay pipelines) can reconstruct the
 * exact contract used at produce time.
 *
 * Design decisions:
 * - JSON Schema (not Avro/Protobuf) — matches our existing Zod-first workflow.
 * - No extra npm package — uses Node 22 native `fetch` for the REST API.
 * - Local cache avoids a round-trip per message after initial registration.
 * - All failures are non-fatal: Zod validation is the hard gate; registry
 *   integration is additive compliance hardening.
 *
 * SOC2 CC6.6 — Change management: schema compatibility is checked before
 *   any breaking change reaches production consumers.
 * ISO 27001 A.8.9 — Configuration management: schema versions are tracked
 *   and immutable once published.
 */

// ─── Config ───────────────────────────────────────────────────────

export interface ConfluentRegistryConfig {
  /** Base URL, e.g. https://pkc-abc.us-east-1.aws.confluent.cloud:443 */
  readonly url: string;
  /** Confluent Cloud API key (maps to HTTP Basic username) */
  readonly apiKey?: string | undefined;
  /** Confluent Cloud API secret (maps to HTTP Basic password) */
  readonly apiSecret?: string | undefined;
  /**
   * Subject naming strategy.
   * - 'record-name' (default): subject = event type string, e.g. 'customer.created'
   * - 'topic-value': subject = '<topic>-value', e.g. 'customer-events-value'
   */
  readonly subjectStrategy?: 'record-name' | 'topic-value' | undefined;
}

// ─── Types ────────────────────────────────────────────────────────

interface RegistrySchemaResponse {
  readonly id: number;
  readonly schema: string;
  readonly schemaType?: string;
  readonly version?: number;
}

interface CompatibilityResponse {
  readonly is_compatible: boolean;
}

interface CacheEntry {
  readonly schemaId: number;
}

// ─── Client ───────────────────────────────────────────────────────

export class ConfluentRegistryClient {
  private readonly baseUrl: string;
  private readonly authHeader: string | undefined;
  private readonly subjectStrategy: 'record-name' | 'topic-value';

  /**
   * In-process cache: schema subject → registered schema ID.
   * Avoids a round-trip to the registry on every publish after startup.
   */
  private readonly cache = new Map<string, CacheEntry>();

  constructor(config: ConfluentRegistryConfig) {
    this.baseUrl = config.url.replace(/\/$/, '');
    this.subjectStrategy = config.subjectStrategy ?? 'record-name';

    if (config.apiKey !== undefined && config.apiSecret !== undefined) {
      const credentials = Buffer.from(`${config.apiKey}:${config.apiSecret}`).toString('base64');
      this.authHeader = `Basic ${credentials}`;
    }
  }

  // ─── Subject Naming ─────────────────────────────────────────────

  /**
   * Derives the Schema Registry subject name from an event type string.
   *
   * record-name:  'customer.created' → 'customer.created'
   * topic-value:  'customer.created' → 'customer-events-value'
   */
  subjectFor(eventType: string): string {
    if (this.subjectStrategy === 'topic-value') {
      const prefix = eventType.split('.')[0] ?? eventType;
      return `${prefix}-events-value`;
    }
    return eventType;
  }

  // ─── Core API ───────────────────────────────────────────────────

  /**
   * Registers a JSON Schema for an event type.
   *
   * Returns the schema ID assigned by the registry. If the identical schema
   * is already registered, the registry returns the existing ID (idempotent).
   * The result is cached locally so subsequent calls return immediately.
   */
  async registerSchema(eventType: string, jsonSchema: object): Promise<number> {
    const subject = this.subjectFor(eventType);
    const cached = this.cache.get(subject);
    if (cached !== undefined) {
      return cached.schemaId;
    }

    const response = await fetch(
      `${this.baseUrl}/subjects/${encodeURIComponent(subject)}/versions`,
      {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify({
          schemaType: 'JSON',
          schema: JSON.stringify(jsonSchema),
        }),
      },
    );

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new SchemaRegistryError(
        `Registration failed for subject '${subject}': HTTP ${response.status} — ${body}`,
        response.status,
        subject,
      );
    }

    const result = (await response.json()) as { id: number };
    this.cache.set(subject, { schemaId: result.id });
    return result.id;
  }

  /**
   * Retrieves a previously registered schema by its numeric ID.
   * Returns null if the ID is unknown.
   */
  async getSchemaById(schemaId: number): Promise<object | null> {
    const response = await fetch(`${this.baseUrl}/schemas/ids/${schemaId}`, {
      headers: this.buildHeaders(),
    });

    if (!response.ok) return null;

    const result = (await response.json()) as RegistrySchemaResponse;
    return JSON.parse(result.schema) as object;
  }

  /**
   * Retrieves the latest registered schema and its metadata for a subject.
   * Returns null if the subject has no registered versions.
   */
  async getLatestSchema(
    eventType: string,
  ): Promise<{
    readonly schemaId: number;
    readonly schema: object;
    readonly version: number;
  } | null> {
    const subject = this.subjectFor(eventType);
    const response = await fetch(
      `${this.baseUrl}/subjects/${encodeURIComponent(subject)}/versions/latest`,
      { headers: this.buildHeaders() },
    );

    if (!response.ok) return null;

    const result = (await response.json()) as RegistrySchemaResponse;
    return {
      schemaId: result.id,
      schema: JSON.parse(result.schema) as object,
      version: result.version ?? 1,
    };
  }

  /**
   * Checks whether a proposed schema is compatible with the latest registered
   * version of a subject, using the registry's configured compatibility mode
   * (BACKWARD by default in Confluent Cloud).
   *
   * Returns true if compatible or if the registry is unreachable (fail-open
   * is intentional — the check is advisory; Zod is the hard gate).
   */
  async checkCompatibility(eventType: string, jsonSchema: object): Promise<boolean> {
    const subject = this.subjectFor(eventType);
    const response = await fetch(
      `${this.baseUrl}/compatibility/subjects/${encodeURIComponent(subject)}/versions/latest`,
      {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify({
          schemaType: 'JSON',
          schema: JSON.stringify(jsonSchema),
        }),
      },
    );

    if (!response.ok) return true; // fail-open: advisory check only

    const result = (await response.json()) as CompatibilityResponse;
    return result.is_compatible;
  }

  // ─── Cache Helpers ──────────────────────────────────────────────

  /**
   * Returns the locally cached schema ID for an event type, or undefined if
   * not yet registered in this process.
   */
  cachedIdFor(eventType: string): number | undefined {
    return this.cache.get(this.subjectFor(eventType))?.schemaId;
  }

  // ─── Private ────────────────────────────────────────────────────

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/vnd.schemaregistry.v1+json',
      Accept: 'application/vnd.schemaregistry.v1+json',
    };
    if (this.authHeader !== undefined) {
      headers['Authorization'] = this.authHeader;
    }
    return headers;
  }
}

// ─── Error ────────────────────────────────────────────────────────

export class SchemaRegistryError extends Error {
  public readonly statusCode: number;
  public readonly subject: string;

  constructor(message: string, statusCode: number, subject: string) {
    super(message);
    this.name = 'SchemaRegistryError';
    this.statusCode = statusCode;
    this.subject = subject;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
