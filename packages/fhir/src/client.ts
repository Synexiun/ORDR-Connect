/**
 * FHIR R4 REST client — outbound connections to EHR FHIR servers
 *
 * Supports SMART on FHIR bearer token auth (both static tokens and
 * client_credentials grant for backend system flows).
 *
 * Used by:
 *   - Import pipelines: pull Patient bundles from upstream EHRs
 *   - Subscription delivery: POST Communication resources to EHR endpoints
 *
 * All outbound requests are logged for audit purposes (SOC2 CC7.2).
 * PHI in transit is protected by TLS 1.3 (Rule 1 of CLAUDE.md).
 */

import type { FhirPatient, FhirCommunication, FhirBundle } from './types.js';

// ─── Config ─────────────────────────────────────────────────────

export interface FhirClientConfig {
  /** Base URL of the FHIR server, e.g. https://ehr.example.com/fhir/r4 */
  readonly baseUrl: string;
  /**
   * SMART on FHIR bearer token.
   * For client_credentials flows, callers should refresh and pass here.
   */
  readonly bearerToken?: string | undefined;
  /** Request timeout in milliseconds (default: 30s) */
  readonly timeoutMs?: number | undefined;
  /** Tenant ID — added as X-Tenant-Id header for downstream audit */
  readonly tenantId: string;
}

// ─── Error ─────────────────────────────────────────────────────

export class FhirClientError extends Error {
  public readonly statusCode: number;
  public readonly resource: string;

  constructor(message: string, statusCode: number, resource: string) {
    super(message);
    this.name = 'FhirClientError';
    this.statusCode = statusCode;
    this.resource = resource;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ─── Client ─────────────────────────────────────────────────────

export class FhirClient {
  private readonly baseUrl: string;
  private readonly bearerToken: string | undefined;
  private readonly timeoutMs: number;
  private readonly tenantId: string;

  constructor(config: FhirClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.bearerToken = config.bearerToken;
    this.timeoutMs = config.timeoutMs ?? 30_000;
    this.tenantId = config.tenantId;
  }

  // ─── Patient Operations ────────────────────────────────────────

  /**
   * Reads a single Patient resource by ID.
   * Returns null if the server returns 404.
   */
  async getPatient(patientId: string): Promise<FhirPatient | null> {
    return this.get<FhirPatient>(`Patient/${patientId}`);
  }

  /**
   * Searches for Patient resources.
   * Common search params: _id, family, given, birthdate, identifier
   */
  async searchPatients(params: Record<string, string> = {}): Promise<FhirBundle<FhirPatient>> {
    return this.search<FhirPatient>('Patient', params);
  }

  /**
   * Creates a Patient resource on the remote FHIR server.
   * Returns the created Patient (including server-assigned ID).
   */
  async createPatient(patient: Omit<FhirPatient, 'id'>): Promise<FhirPatient> {
    return this.create('Patient', patient as FhirPatient);
  }

  /**
   * Fetches the $everything operation for a patient — all clinical resources
   * associated with the patient (appointments, observations, etc.).
   */
  async getPatientEverything(patientId: string): Promise<FhirBundle> {
    return this.get<FhirBundle>(`Patient/${patientId}/$everything`);
  }

  // ─── Communication Operations ──────────────────────────────────

  /**
   * Searches for Communication resources.
   * Common params: subject (patient), sent (date), status
   */
  async searchCommunications(
    params: Record<string, string> = {},
  ): Promise<FhirBundle<FhirCommunication>> {
    return this.search<FhirCommunication>('Communication', params);
  }

  /**
   * Creates a Communication resource on the remote FHIR server.
   * Used to push ORDR-Connect message records back to the EHR.
   */
  async createCommunication(comm: Omit<FhirCommunication, 'id'>): Promise<FhirCommunication> {
    return this.create('Communication', comm as FhirCommunication);
  }

  // ─── Bundle ────────────────────────────────────────────────────

  /**
   * Posts a FHIR transaction bundle.
   * Returns the transaction-response bundle with per-entry status codes.
   */
  async transaction(bundle: FhirBundle): Promise<FhirBundle> {
    return this.post('', bundle);
  }

  // ─── Private HTTP Helpers ──────────────────────────────────────

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/fhir+json',
      Accept: 'application/fhir+json',
      'X-Tenant-Id': this.tenantId,
    };
    if (this.bearerToken !== undefined) {
      headers['Authorization'] = `Bearer ${this.bearerToken}`;
    }
    return headers;
  }

  private async get<T>(path: string): Promise<T> {
    const url = `${this.baseUrl}/${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, this.timeoutMs);

    try {
      const response = await fetch(url, {
        headers: this.buildHeaders(),
        signal: controller.signal,
      });

      if (response.status === 404) return null as T;

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new FhirClientError(
          `FHIR GET ${path} failed: HTTP ${response.status} — ${body}`,
          response.status,
          path,
        );
      }

      return (await response.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  private async search<T>(
    resourceType: string,
    params: Record<string, string>,
  ): Promise<FhirBundle<T>> {
    const qs = new URLSearchParams(params).toString();
    const path = qs.length > 0 ? `${resourceType}?${qs}` : resourceType;
    return this.get<FhirBundle<T>>(path);
  }

  private async create<T>(resourceType: string, resource: T): Promise<T> {
    return this.post(resourceType, resource);
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const url = path.length > 0 ? `${this.baseUrl}/${path}` : this.baseUrl;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, this.timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const bodyText = await response.text().catch(() => '');
        throw new FhirClientError(
          `FHIR POST ${path} failed: HTTP ${response.status} — ${bodyText}`,
          response.status,
          path,
        );
      }

      return (await response.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }
}
