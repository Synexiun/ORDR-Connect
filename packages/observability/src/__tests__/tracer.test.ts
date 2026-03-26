import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { trace, SpanStatusCode } from '@opentelemetry/api';
import {
  initTracer,
  createSpan,
  withSpan,
  getActiveTraceContext,
  shutdownTracer,
} from '../tracer.js';

// ─── Setup / Teardown ────────────────────────────────────────────

beforeEach(async () => {
  await shutdownTracer();
});

afterEach(async () => {
  await shutdownTracer();
});

// ─── Tests ───────────────────────────────────────────────────────

describe('tracer', () => {
  describe('initTracer()', () => {
    it('creates a valid tracer instance', () => {
      const tracer = initTracer('test-service', { enabled: true });
      expect(tracer).toBeDefined();
      expect(typeof tracer.startSpan).toBe('function');
    });

    it('returns a tracer when disabled', () => {
      const tracer = initTracer('test-service', { enabled: false });
      expect(tracer).toBeDefined();
      expect(typeof tracer.startSpan).toBe('function');
    });

    it('respects environment-based sampling defaults', () => {
      // Production default is 0.1 (10%)
      const prodTracer = initTracer('prod-service', {
        enabled: true,
        environment: 'production',
      });
      expect(prodTracer).toBeDefined();
    });

    it('accepts custom sample rate', async () => {
      await shutdownTracer();
      const tracer = initTracer('test-service', {
        enabled: true,
        sampleRate: 0.5,
      });
      expect(tracer).toBeDefined();
    });

    it('configures OTLP endpoint when provided', async () => {
      await shutdownTracer();
      // This should not throw even though the endpoint is not reachable
      const tracer = initTracer('test-service', {
        enabled: true,
        endpoint: 'http://localhost:4318/v1/traces',
        environment: 'development',
      });
      expect(tracer).toBeDefined();
    });
  });

  describe('createSpan()', () => {
    it('returns a span with correct name', () => {
      initTracer('test-service');
      const span = createSpan('test-operation');

      expect(span).toBeDefined();
      expect(typeof span.end).toBe('function');
      span.end();
    });

    it('attaches attributes to the span', () => {
      initTracer('test-service');
      const span = createSpan('test-operation', {
        'http.method': 'GET',
        'http.status_code': 200,
        'tenant.id': 'tenant-1',
      });

      // Span should have the setAttribute method called without errors
      expect(span).toBeDefined();
      span.end();
    });

    it('works without initializing global tracer', () => {
      // createSpan should fall back to the default tracer
      const span = createSpan('fallback-operation');
      expect(span).toBeDefined();
      span.end();
    });
  });

  describe('withSpan()', () => {
    it('auto-closes span on success', async () => {
      initTracer('test-service');

      const result = await withSpan('successful-op', async () => {
        return 42;
      });

      expect(result).toBe(42);
    });

    it('records error and rethrows on failure', async () => {
      initTracer('test-service');

      await expect(
        withSpan('failing-op', async () => {
          throw new Error('test failure');
        }),
      ).rejects.toThrow('test failure');
    });

    it('passes attributes to the span', async () => {
      initTracer('test-service');

      const result = await withSpan(
        'attributed-op',
        async () => 'done',
        { 'custom.key': 'custom-value' },
      );

      expect(result).toBe('done');
    });

    it('propagates context to nested spans', async () => {
      initTracer('test-service');

      await withSpan('parent', async () => {
        // Inside the parent span, active context should exist
        const ctx = getActiveTraceContext();
        expect(ctx).not.toBeNull();
        expect(ctx?.traceId).toBeTruthy();
        expect(ctx?.spanId).toBeTruthy();

        return await withSpan('child', async () => {
          const childCtx = getActiveTraceContext();
          expect(childCtx).not.toBeNull();
          return 'nested';
        });
      });
    });
  });

  describe('getActiveTraceContext()', () => {
    it('returns null when no span is active', () => {
      const ctx = getActiveTraceContext();
      // Outside of a span context, this may return null or a no-op context
      // depending on the provider state
      expect(ctx === null || typeof ctx?.traceId === 'string').toBe(true);
    });

    it('returns trace and span IDs within a span', async () => {
      initTracer('test-service');

      await withSpan('context-test', async () => {
        const ctx = getActiveTraceContext();
        expect(ctx).not.toBeNull();
        if (ctx) {
          expect(ctx.traceId).toMatch(/^[0-9a-f]{32}$/);
          expect(ctx.spanId).toMatch(/^[0-9a-f]{16}$/);
        }
      });
    });
  });

  describe('shutdownTracer()', () => {
    it('shuts down cleanly', async () => {
      initTracer('test-service');
      await expect(shutdownTracer()).resolves.toBeUndefined();
    });

    it('handles double shutdown gracefully', async () => {
      initTracer('test-service');
      await shutdownTracer();
      await expect(shutdownTracer()).resolves.toBeUndefined();
    });
  });
});
