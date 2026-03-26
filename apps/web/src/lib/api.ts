/**
 * ORDR-Connect API Client
 *
 * Compliance requirements:
 * - Every request includes X-Request-Id (correlation ID) for audit trail
 * - Authorization header auto-attached from in-memory token store
 * - 401 responses trigger automatic redirect to login (clear auth state)
 * - No sensitive data in URLs or query parameters
 */

// In-memory token store — NOT localStorage/sessionStorage (HIPAA §164.312)
let accessToken: string | null = null;
let onUnauthorized: (() => void) | null = null;

function generateRequestId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function setOnUnauthorized(callback: () => void): void {
  onUnauthorized = callback;
}

interface ApiError {
  message: string;
  code: string;
  correlationId: string;
  status: number;
}

export class ApiRequestError extends Error {
  public readonly code: string;
  public readonly correlationId: string;
  public readonly status: number;

  constructor(error: ApiError) {
    super(error.message);
    this.name = 'ApiRequestError';
    this.code = error.code;
    this.correlationId = error.correlationId;
    this.status = error.status;
  }
}

interface RequestOptions {
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

const BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  options?: RequestOptions,
): Promise<T> {
  const requestId = generateRequestId();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Request-Id': requestId,
    ...options?.headers,
  };

  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  const config: RequestInit = {
    method,
    headers,
    signal: options?.signal ?? null,
  };

  if (body !== undefined && method !== 'GET') {
    config.body = JSON.stringify(body);
  }

  const response = await fetch(`${BASE_URL}${path}`, config);

  if (response.status === 401) {
    setAccessToken(null);
    if (onUnauthorized) {
      onUnauthorized();
    }
    throw new ApiRequestError({
      message: 'Authentication required',
      code: 'UNAUTHORIZED',
      correlationId: requestId,
      status: 401,
    });
  }

  if (!response.ok) {
    let errorBody: { message?: string; code?: string } = {};
    try {
      errorBody = await response.json();
    } catch {
      // Response body may not be JSON
    }

    throw new ApiRequestError({
      message: errorBody.message || `Request failed with status ${response.status}`,
      code: errorBody.code || 'REQUEST_FAILED',
      correlationId: requestId,
      status: response.status,
    });
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

export const apiClient = {
  get<T>(path: string, options?: RequestOptions): Promise<T> {
    return request<T>('GET', path, undefined, options);
  },

  post<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return request<T>('POST', path, body, options);
  },

  patch<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return request<T>('PATCH', path, body, options);
  },

  delete<T>(path: string, options?: RequestOptions): Promise<T> {
    return request<T>('DELETE', path, undefined, options);
  },
};
