import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  AlertManager,
  WebhookNotifier,
  PREDEFINED_ALERTS,
  SEVERITY_ROUTING,
} from '../alerts.js';
import type { AlertEvent } from '../alerts.js';

// ─── Tests ───────────────────────────────────────────────────────

describe('AlertManager', () => {
  let manager: AlertManager;

  beforeEach(() => {
    manager = new AlertManager(300);
    manager.clearDeduplication();
  });

  describe('predefined rules', () => {
    it('registers all predefined alert rules', () => {
      expect(manager.getRuleCount()).toBe(PREDEFINED_ALERTS.length);
    });

    it('has auth_failure_spike rule', () => {
      const rule = manager.getRule('auth_failure_spike');
      expect(rule).toBeDefined();
      expect(rule!.severity).toBe('P1');
      expect(rule!.threshold).toBe(10);
    });

    it('has audit_chain_break rule as P0', () => {
      const rule = manager.getRule('audit_chain_break');
      expect(rule).toBeDefined();
      expect(rule!.severity).toBe('P0');
    });

    it('has agent_safety_threshold rule', () => {
      const rule = manager.getRule('agent_safety_threshold');
      expect(rule).toBeDefined();
      expect(rule!.severity).toBe('P1');
    });

    it('has p95_latency_degradation rule', () => {
      const rule = manager.getRule('p95_latency_degradation');
      expect(rule).toBeDefined();
      expect(rule!.severity).toBe('P2');
    });

    it('has kafka_consumer_lag rule', () => {
      const rule = manager.getRule('kafka_consumer_lag');
      expect(rule).toBeDefined();
      expect(rule!.threshold).toBe(10000);
    });

    it('has compliance_violation_critical rule as P0', () => {
      const rule = manager.getRule('compliance_violation_critical');
      expect(rule).toBeDefined();
      expect(rule!.severity).toBe('P0');
    });

    it('has encryption_key_rotation_overdue rule', () => {
      const rule = manager.getRule('encryption_key_rotation_overdue');
      expect(rule).toBeDefined();
      expect(rule!.threshold).toBe(75);
    });

    it('has error_rate_spike rule', () => {
      const rule = manager.getRule('error_rate_spike');
      expect(rule).toBeDefined();
      expect(rule!.severity).toBe('P1');
    });

    it('returns all rule names', () => {
      const names = manager.getRuleNames();
      expect(names).toContain('auth_failure_spike');
      expect(names).toContain('audit_chain_break');
      expect(names).toContain('error_rate_spike');
    });
  });

  describe('evaluate()', () => {
    it('triggers alert when value meets threshold', () => {
      const event = manager.evaluate('auth_failure_spike', 15, 'tenant-1');
      expect(event).not.toBeNull();
      expect(event!.ruleName).toBe('auth_failure_spike');
      expect(event!.value).toBe(15);
      expect(event!.threshold).toBe(10);
    });

    it('triggers alert when value equals threshold', () => {
      const event = manager.evaluate('auth_failure_spike', 10, 'tenant-1');
      expect(event).not.toBeNull();
    });

    it('does not trigger when value is below threshold', () => {
      const event = manager.evaluate('auth_failure_spike', 5, 'tenant-1');
      expect(event).toBeNull();
    });

    it('returns null for unknown rule', () => {
      const event = manager.evaluate('nonexistent_rule', 100);
      expect(event).toBeNull();
    });

    it('includes tenant_id in the alert event', () => {
      const event = manager.evaluate('audit_chain_break', 1, 'tenant-abc');
      expect(event!.tenantId).toBe('tenant-abc');
    });

    it('includes timestamp in the alert event', () => {
      const event = manager.evaluate('audit_chain_break', 1);
      expect(event!.timestamp).toBeInstanceOf(Date);
    });

    it('includes channels from the rule definition', () => {
      const event = manager.evaluate('audit_chain_break', 1);
      expect(event!.channels).toContain('pagerduty');
      expect(event!.channels).toContain('slack');
      expect(event!.channels).toContain('email');
    });
  });

  describe('alert deduplication', () => {
    it('deduplicates alerts within the window', () => {
      const event1 = manager.evaluate('auth_failure_spike', 15, 'tenant-1');
      const event2 = manager.evaluate('auth_failure_spike', 20, 'tenant-1');

      expect(event1).not.toBeNull();
      expect(event2).toBeNull(); // Deduplicated
    });

    it('allows alerts for different tenants', () => {
      const event1 = manager.evaluate('auth_failure_spike', 15, 'tenant-1');
      const event2 = manager.evaluate('auth_failure_spike', 15, 'tenant-2');

      expect(event1).not.toBeNull();
      expect(event2).not.toBeNull(); // Different tenant = different dedup key
    });

    it('allows alerts for different rules on same tenant', () => {
      const event1 = manager.evaluate('auth_failure_spike', 15, 'tenant-1');
      const event2 = manager.evaluate('error_rate_spike', 0.1, 'tenant-1');

      expect(event1).not.toBeNull();
      expect(event2).not.toBeNull();
    });

    it('clears deduplication state', () => {
      manager.evaluate('auth_failure_spike', 15, 'tenant-1');
      manager.clearDeduplication();
      const event = manager.evaluate('auth_failure_spike', 15, 'tenant-1');

      expect(event).not.toBeNull();
    });
  });

  describe('severity routing', () => {
    it('P0 routes to pagerduty, slack, and email', () => {
      const channels = AlertManager.getRoutingForSeverity('P0');
      expect(channels).toContain('pagerduty');
      expect(channels).toContain('slack');
      expect(channels).toContain('email');
    });

    it('P1 routes to slack and pagerduty', () => {
      const channels = AlertManager.getRoutingForSeverity('P1');
      expect(channels).toContain('slack');
      expect(channels).toContain('pagerduty');
    });

    it('P2 routes to slack', () => {
      const channels = AlertManager.getRoutingForSeverity('P2');
      expect(channels).toContain('slack');
    });

    it('P3 routes to email', () => {
      const channels = AlertManager.getRoutingForSeverity('P3');
      expect(channels).toContain('email');
    });
  });
});

describe('WebhookNotifier', () => {
  it('sends alert to configured endpoint', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(null, { status: 200 }),
    );

    const notifier = new WebhookNotifier({
      url: 'https://hooks.example.com/alert',
    });

    const event: AlertEvent = {
      ruleName: 'auth_failure_spike',
      severity: 'P1',
      description: 'Auth failure spike detected',
      value: 15,
      threshold: 10,
      timestamp: new Date('2026-01-01T00:00:00.000Z'),
      tenantId: 'tenant-1',
      channels: ['slack'],
    };

    const result = await notifier.notify(event);
    expect(result).toBe(true);

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, options] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('https://hooks.example.com/alert');
    expect(options!.method).toBe('POST');

    const body = JSON.parse(options!.body as string) as Record<string, unknown>;
    expect(body['alert']).toBe('auth_failure_spike');
    expect(body['severity']).toBe('P1');
    expect(body['tenantId']).toBe('tenant-1');

    fetchSpy.mockRestore();
  });

  it('returns false on fetch failure', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(
      new Error('Network error'),
    );

    const notifier = new WebhookNotifier({
      url: 'https://hooks.example.com/alert',
    });

    const event: AlertEvent = {
      ruleName: 'test',
      severity: 'P2',
      description: 'Test',
      value: 1,
      threshold: 1,
      timestamp: new Date(),
      channels: ['slack'],
    };

    const result = await notifier.notify(event);
    expect(result).toBe(false);

    fetchSpy.mockRestore();
  });

  it('returns false on non-OK response', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(null, { status: 500 }),
    );

    const notifier = new WebhookNotifier({
      url: 'https://hooks.example.com/alert',
    });

    const event: AlertEvent = {
      ruleName: 'test',
      severity: 'P2',
      description: 'Test',
      value: 1,
      threshold: 1,
      timestamp: new Date(),
      channels: ['slack'],
    };

    const result = await notifier.notify(event);
    expect(result).toBe(false);

    fetchSpy.mockRestore();
  });

  it('includes custom headers', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(null, { status: 200 }),
    );

    const notifier = new WebhookNotifier({
      url: 'https://hooks.example.com/alert',
      headers: { 'X-Api-Key': 'secret-key' },
    });

    const event: AlertEvent = {
      ruleName: 'test',
      severity: 'P2',
      description: 'Test',
      value: 1,
      threshold: 1,
      timestamp: new Date(),
      channels: ['slack'],
    };

    await notifier.notify(event);

    const options = fetchSpy.mock.calls[0]![1]!;
    const headers = options.headers as Record<string, string>;
    expect(headers['X-Api-Key']).toBe('secret-key');

    fetchSpy.mockRestore();
  });

  it('exposes the configured URL', () => {
    const notifier = new WebhookNotifier({
      url: 'https://hooks.example.com/alert',
    });
    expect(notifier.getUrl()).toBe('https://hooks.example.com/alert');
  });
});

describe('SEVERITY_ROUTING', () => {
  it('defines routing for all severity levels', () => {
    expect(SEVERITY_ROUTING.P0).toBeDefined();
    expect(SEVERITY_ROUTING.P1).toBeDefined();
    expect(SEVERITY_ROUTING.P2).toBeDefined();
    expect(SEVERITY_ROUTING.P3).toBeDefined();
  });
});

describe('PREDEFINED_ALERTS', () => {
  it('has at least 8 predefined alert rules', () => {
    expect(PREDEFINED_ALERTS.length).toBeGreaterThanOrEqual(8);
  });

  it('all rules have required fields', () => {
    for (const rule of PREDEFINED_ALERTS) {
      expect(rule.name).toBeTruthy();
      expect(rule.description).toBeTruthy();
      expect(['P0', 'P1', 'P2', 'P3']).toContain(rule.severity);
      expect(rule.channels.length).toBeGreaterThan(0);
      expect(typeof rule.threshold).toBe('number');
    }
  });
});
