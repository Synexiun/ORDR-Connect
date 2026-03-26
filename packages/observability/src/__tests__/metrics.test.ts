import { describe, it, expect, beforeEach } from 'vitest';
import { MetricsRegistry, PREDEFINED_METRICS } from '../metrics.js';

// ─── Setup ───────────────────────────────────────────────────────

let registry: MetricsRegistry;

beforeEach(() => {
  // Disable default Node.js metrics in tests for predictable output
  registry = new MetricsRegistry(false);
});

// ─── Tests ───────────────────────────────────────────────────────

describe('MetricsRegistry', () => {
  describe('predefined metrics registration', () => {
    it('registers all predefined counter metrics', () => {
      const counters = PREDEFINED_METRICS.filter((m) => m.type === 'counter');
      for (const def of counters) {
        expect(registry.hasCounter(def.name)).toBe(true);
      }
    });

    it('registers all predefined histogram metrics', () => {
      const histograms = PREDEFINED_METRICS.filter((m) => m.type === 'histogram');
      for (const def of histograms) {
        expect(registry.hasHistogram(def.name)).toBe(true);
      }
    });

    it('registers all predefined gauge metrics', () => {
      const gauges = PREDEFINED_METRICS.filter((m) => m.type === 'gauge');
      for (const def of gauges) {
        expect(registry.hasGauge(def.name)).toBe(true);
      }
    });

    it('includes http_requests_total counter', () => {
      expect(registry.hasCounter('http_requests_total')).toBe(true);
    });

    it('includes http_request_duration_seconds histogram', () => {
      expect(registry.hasHistogram('http_request_duration_seconds')).toBe(true);
    });

    it('includes db_query_duration_seconds histogram', () => {
      expect(registry.hasHistogram('db_query_duration_seconds')).toBe(true);
    });

    it('includes agent_execution_duration_seconds histogram', () => {
      expect(registry.hasHistogram('agent_execution_duration_seconds')).toBe(true);
    });

    it('includes active_agent_sessions gauge', () => {
      expect(registry.hasGauge('active_agent_sessions')).toBe(true);
    });

    it('includes kafka_consumer_lag gauge', () => {
      expect(registry.hasGauge('kafka_consumer_lag')).toBe(true);
    });

    it('includes compliance_violations_total counter', () => {
      expect(registry.hasCounter('compliance_violations_total')).toBe(true);
    });

    it('includes encryption_operations_total counter', () => {
      expect(registry.hasCounter('encryption_operations_total')).toBe(true);
    });
  });

  describe('counter operations', () => {
    it('increments a counter', async () => {
      registry.incrementCounter('http_requests_total', {
        method: 'GET',
        path: '/api/v1/customers',
        status: '200',
        tenant_id: 'tenant-1',
      });

      const output = await registry.getMetricsEndpoint();
      expect(output).toContain('http_requests_total');
    });

    it('increments a counter by a custom value', async () => {
      registry.incrementCounter('audit_events_total', {
        action_type: 'data.created',
      }, 5);

      const output = await registry.getMetricsEndpoint();
      expect(output).toContain('audit_events_total');
    });

    it('throws on unknown counter name', () => {
      expect(() => {
        registry.incrementCounter('nonexistent_counter', {});
      }).toThrow('Counter not found: nonexistent_counter');
    });

    it('includes tenant_id label in http_requests_total', async () => {
      registry.incrementCounter('http_requests_total', {
        method: 'POST',
        path: '/api/v1/agents',
        status: '201',
        tenant_id: 'tenant-xyz',
      });

      const output = await registry.getMetricsEndpoint();
      expect(output).toContain('tenant_id="tenant-xyz"');
    });
  });

  describe('histogram operations', () => {
    it('records a histogram observation', async () => {
      registry.observeHistogram('http_request_duration_seconds', {
        method: 'GET',
        path: '/api/v1/customers',
      }, 0.125);

      const output = await registry.getMetricsEndpoint();
      expect(output).toContain('http_request_duration_seconds');
    });

    it('records multiple histogram values', async () => {
      for (let i = 0; i < 10; i++) {
        registry.observeHistogram('db_query_duration_seconds', {
          operation: 'select',
          table: 'customers',
        }, Math.random() * 0.5);
      }

      const output = await registry.getMetricsEndpoint();
      expect(output).toContain('db_query_duration_seconds_count');
    });

    it('throws on unknown histogram name', () => {
      expect(() => {
        registry.observeHistogram('nonexistent_histogram', {}, 1);
      }).toThrow('Histogram not found: nonexistent_histogram');
    });
  });

  describe('gauge operations', () => {
    it('sets a gauge value', async () => {
      registry.setGauge('active_agent_sessions', {
        agent_role: 'sales',
        tenant_id: 'tenant-1',
      }, 5);

      const output = await registry.getMetricsEndpoint();
      expect(output).toContain('active_agent_sessions');
    });

    it('increments a gauge', async () => {
      registry.incrementGauge('active_agent_sessions', {
        agent_role: 'support',
        tenant_id: 'tenant-2',
      });

      const output = await registry.getMetricsEndpoint();
      expect(output).toContain('active_agent_sessions');
    });

    it('decrements a gauge', async () => {
      registry.setGauge('kafka_consumer_lag', {
        topic: 'events',
        consumer_group: 'worker-1',
      }, 100);

      registry.decrementGauge('kafka_consumer_lag', {
        topic: 'events',
        consumer_group: 'worker-1',
      }, 10);

      const output = await registry.getMetricsEndpoint();
      expect(output).toContain('kafka_consumer_lag');
    });

    it('throws on unknown gauge name', () => {
      expect(() => {
        registry.setGauge('nonexistent_gauge', {}, 1);
      }).toThrow('Gauge not found: nonexistent_gauge');
    });
  });

  describe('Prometheus /metrics endpoint', () => {
    it('returns Prometheus text format', async () => {
      registry.incrementCounter('http_requests_total', {
        method: 'GET',
        path: '/health',
        status: '200',
        tenant_id: 'system',
      });

      const output = await registry.getMetricsEndpoint();
      // Prometheus format uses # HELP and # TYPE comments
      expect(output).toContain('# HELP http_requests_total');
      expect(output).toContain('# TYPE http_requests_total counter');
    });

    it('returns correct content type', () => {
      const contentType = registry.getContentType();
      expect(contentType).toContain('text/plain');
    });
  });

  describe('PHI safety', () => {
    it('does not allow PHI in metric labels by design', () => {
      // This test verifies our metric definitions use safe label names only.
      // Labels like 'method', 'path', 'status', 'tenant_id' are safe identifiers.
      // PHI fields like 'patient_name', 'ssn', 'email' are NOT metric labels.
      const allLabelNames = PREDEFINED_METRICS.flatMap((m) => [...m.labelNames]);

      const phiLabels = ['patient_name', 'ssn', 'email', 'phone', 'address', 'mrn', 'dob'];
      for (const phiLabel of phiLabels) {
        expect(allLabelNames).not.toContain(phiLabel);
      }
    });
  });

  describe('introspection', () => {
    it('returns all registered metric definitions', () => {
      const defs = registry.getRegisteredMetrics();
      expect(defs.length).toBe(PREDEFINED_METRICS.length);
    });

    it('resets all metrics', async () => {
      registry.incrementCounter('http_requests_total', {
        method: 'GET',
        path: '/test',
        status: '200',
        tenant_id: 'test',
      });

      registry.resetAll();

      // After reset, counters should be at 0
      const output = await registry.getMetricsEndpoint();
      // The metric definition should still exist
      expect(output).toContain('http_requests_total');
    });
  });
});
