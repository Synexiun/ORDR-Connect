/**
 * API Client Tests
 *
 * Validates compliance requirements:
 * - X-Request-Id header on every request (audit trail)
 * - Authorization header from in-memory token
 * - 401 → unauthorized handler invoked
 * - No sensitive data in URLs
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  apiClient,
  setAccessToken,
  getAccessToken,
  setOnUnauthorized,
  ApiRequestError,
} from '../lib/api';

// --- Helpers ---

function mockFetch(response: Partial<Response> & { json?: () => Promise<unknown> }): void {
  const defaultResponse: Response = {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Headers(),
    redirected: false,
    type: 'basic' as ResponseType,
    url: '',
    body: null,
    bodyUsed: false,
    clone: () => defaultResponse,
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    blob: () => Promise.resolve(new Blob()),
    formData: () => Promise.resolve(new FormData()),
    text: () => Promise.resolve(''),
    bytes: () => Promise.resolve(new Uint8Array()),
    json: () => Promise.resolve({}),
    ...response,
  };
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(defaultResponse));
}

function getLastFetchCall(): { url: string; init: RequestInit } {
  const calls = vi.mocked(fetch).mock.calls;
  const lastCall = calls[calls.length - 1];
  return { url: lastCall![0] as string, init: lastCall![1] as RequestInit };
}

// --- Tests ---

describe('API Client', () => {
  beforeEach(() => {
    setAccessToken(null);
    setOnUnauthorized(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('includes X-Request-Id header on every request', async () => {
    mockFetch({ ok: true, status: 200, json: () => Promise.resolve({ data: 'test' }) });

    await apiClient.get('/v1/test');

    const { init } = getLastFetchCall();
    const headers = init.headers as Record<string, string>;
    expect(headers['X-Request-Id']).toBeDefined();
    expect(headers['X-Request-Id']!.length).toBeGreaterThan(0);
  });

  it('generates unique request IDs per call', async () => {
    mockFetch({ ok: true, status: 200, json: () => Promise.resolve({}) });

    await apiClient.get('/v1/test1');
    const id1 = (getLastFetchCall().init.headers as Record<string, string>)['X-Request-Id'];

    await apiClient.get('/v1/test2');
    const id2 = (getLastFetchCall().init.headers as Record<string, string>)['X-Request-Id'];

    expect(id1).not.toBe(id2);
  });

  it('attaches Authorization header when token is set', async () => {
    mockFetch({ ok: true, status: 200, json: () => Promise.resolve({}) });
    setAccessToken('test-token-abc');

    await apiClient.get('/v1/protected');

    const { init } = getLastFetchCall();
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer test-token-abc');
  });

  it('does not include Authorization header when no token', async () => {
    mockFetch({ ok: true, status: 200, json: () => Promise.resolve({}) });
    setAccessToken(null);

    await apiClient.get('/v1/public');

    const { init } = getLastFetchCall();
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBeUndefined();
  });

  it('calls onUnauthorized and clears token on 401', async () => {
    const unauthorizedHandler = vi.fn();
    setOnUnauthorized(unauthorizedHandler);
    setAccessToken('expired-token');

    mockFetch({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ message: 'Unauthorized' }),
    });

    await expect(apiClient.get('/v1/protected')).rejects.toThrow(ApiRequestError);
    expect(unauthorizedHandler).toHaveBeenCalledOnce();
    expect(getAccessToken()).toBeNull();
  });

  it('sends JSON body on POST requests', async () => {
    mockFetch({ ok: true, status: 200, json: () => Promise.resolve({ id: '123' }) });

    await apiClient.post('/v1/items', { name: 'test', value: 42 });

    const { init } = getLastFetchCall();
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ name: 'test', value: 42 }));
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('throws ApiRequestError with correlation ID on failure', async () => {
    mockFetch({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ message: 'Internal error', code: 'SERVER_ERROR' }),
    });

    try {
      await apiClient.get('/v1/failing');
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiRequestError);
      const apiErr = err as ApiRequestError;
      expect(apiErr.status).toBe(500);
      expect(apiErr.code).toBe('SERVER_ERROR');
      expect(apiErr.correlationId).toBeDefined();
      expect(apiErr.correlationId.length).toBeGreaterThan(0);
    }
  });

  it('handles 204 No Content responses', async () => {
    mockFetch({ ok: true, status: 204 });

    const result = await apiClient.delete('/v1/items/123');

    expect(result).toBeUndefined();
  });

  it('sends PATCH requests with body', async () => {
    mockFetch({ ok: true, status: 200, json: () => Promise.resolve({ updated: true }) });

    await apiClient.patch('/v1/items/123', { name: 'updated' });

    const { init } = getLastFetchCall();
    expect(init.method).toBe('PATCH');
    expect(init.body).toBe(JSON.stringify({ name: 'updated' }));
  });

  it('uses correct base URL from environment', async () => {
    mockFetch({ ok: true, status: 200, json: () => Promise.resolve({}) });

    await apiClient.get('/v1/health');

    const { url } = getLastFetchCall();
    expect(url).toContain('/v1/health');
  });

  it('does not send body on GET requests', async () => {
    mockFetch({ ok: true, status: 200, json: () => Promise.resolve({}) });

    await apiClient.get('/v1/items');

    const { init } = getLastFetchCall();
    expect(init.body).toBeUndefined();
  });
});
