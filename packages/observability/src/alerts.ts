/**
 * @ordr/observability — Alert rule definitions, evaluation, and routing
 *
 * SOC2 CC7.3 — Monitoring: alerting on security and operational events.
 * ISO 27001 A.5.24 — Incident management: automated alert escalation.
 * HIPAA §164.308(a)(6) — Security incident procedures: detect and respond.
 *
 * SECURITY:
 * - Alert payloads MUST NEVER contain PHI/PII
 * - tenant_id is safe (opaque identifier)
 * - Alert messages describe the condition, NOT the data
 */

import type { AlertRule, AlertSeverity, AlertChannel } from './types.js';

// ─── Predefined Alert Rules ─────────────────────────────────────

const PREDEFINED_ALERTS: readonly AlertRule[] = [
  {
    name: 'auth_failure_spike',
    description: 'More than 10 failed authentication attempts in 5 minutes per tenant',
    severity: 'P1',
    condition: 'rate(auth_failures_total[5m]) > 10',
    channels: ['slack', 'pagerduty'],
    windowSeconds: 300,
    threshold: 10,
  },
  {
    name: 'audit_chain_break',
    description: 'Hash chain verification failed — potential tampering detected',
    severity: 'P0',
    condition: 'audit_chain_verification_failed == 1',
    channels: ['pagerduty', 'slack', 'email'],
    windowSeconds: 0, // Immediate
    threshold: 1,
  },
  {
    name: 'agent_safety_threshold',
    description: 'Agent action executed below 0.5 confidence threshold',
    severity: 'P1',
    condition: 'agent_action_confidence < 0.5',
    channels: ['slack', 'pagerduty'],
    windowSeconds: 0,
    threshold: 1,
  },
  {
    name: 'p95_latency_degradation',
    description: 'P95 request latency exceeds 2 seconds for 5 minutes',
    severity: 'P2',
    condition: 'histogram_quantile(0.95, http_request_duration_seconds) > 2 for 5m',
    channels: ['slack'],
    windowSeconds: 300,
    threshold: 2,
  },
  {
    name: 'kafka_consumer_lag',
    description: 'Kafka consumer lag exceeds 10,000 messages',
    severity: 'P2',
    condition: 'kafka_consumer_lag > 10000',
    channels: ['slack'],
    windowSeconds: 60,
    threshold: 10000,
  },
  {
    name: 'compliance_violation_critical',
    description: 'Critical compliance violation detected',
    severity: 'P0',
    condition: 'compliance_violations_total{severity="critical"} > 0',
    channels: ['pagerduty', 'slack', 'email'],
    windowSeconds: 0,
    threshold: 1,
  },
  {
    name: 'encryption_key_rotation_overdue',
    description: 'Encryption key age exceeds 75 days (max 90-day rotation)',
    severity: 'P2',
    condition: 'encryption_key_age_days > 75',
    channels: ['slack'],
    windowSeconds: 86400, // Check daily
    threshold: 75,
  },
  {
    name: 'error_rate_spike',
    description: 'Error rate exceeds 5% for 5 minutes',
    severity: 'P1',
    condition: 'rate(http_requests_total{status=~"5.."}[5m]) / rate(http_requests_total[5m]) > 0.05',
    channels: ['slack', 'pagerduty'],
    windowSeconds: 300,
    threshold: 0.05,
  },
] as const;

// ─── Severity Routing ────────────────────────────────────────────

const SEVERITY_ROUTING: Readonly<Record<AlertSeverity, readonly AlertChannel[]>> = {
  P0: ['pagerduty', 'slack', 'email'],
  P1: ['slack', 'pagerduty'],
  P2: ['slack'],
  P3: ['email'],
} as const;

// ─── Alert Event ─────────────────────────────────────────────────

export interface AlertEvent {
  readonly ruleName: string;
  readonly severity: AlertSeverity;
  readonly description: string;
  readonly value: number;
  readonly threshold: number;
  readonly timestamp: Date;
  readonly tenantId?: string | undefined;
  readonly channels: readonly AlertChannel[];
}

// ─── Webhook Notifier ────────────────────────────────────────────

export interface WebhookConfig {
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>> | undefined;
  readonly timeoutMs?: number | undefined;
}

export class WebhookNotifier {
  private readonly config: WebhookConfig;

  constructor(config: WebhookConfig) {
    this.config = config;
  }

  /**
   * Send an alert event to the configured webhook endpoint.
   * SECURITY: Alert payload contains NO PHI/PII — only metric conditions.
   */
  async notify(event: AlertEvent): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        this.config.timeoutMs ?? 5000,
      );

      const response = await fetch(this.config.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.config.headers,
        },
        body: JSON.stringify({
          alert: event.ruleName,
          severity: event.severity,
          description: event.description,
          value: event.value,
          threshold: event.threshold,
          timestamp: event.timestamp.toISOString(),
          tenantId: event.tenantId,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      return response.ok;
    } catch {
      // Alert delivery failure is logged but NEVER crashes the service
      return false;
    }
  }

  getUrl(): string {
    return this.config.url;
  }
}

// ─── Alert Manager ───────────────────────────────────────────────

export class AlertManager {
  private readonly rules: Map<string, AlertRule>;
  private readonly notifiers: Map<AlertChannel, WebhookNotifier>;
  private readonly deduplicationWindow: Map<string, number>;
  private readonly deduplicationSeconds: number;

  constructor(deduplicationSeconds: number = 300) {
    this.rules = new Map();
    this.notifiers = new Map();
    this.deduplicationWindow = new Map();
    this.deduplicationSeconds = deduplicationSeconds;

    // Register all predefined alert rules
    for (const rule of PREDEFINED_ALERTS) {
      this.rules.set(rule.name, rule);
    }
  }

  /**
   * Register a webhook notifier for a specific channel.
   */
  registerNotifier(channel: AlertChannel, notifier: WebhookNotifier): void {
    this.notifiers.set(channel, notifier);
  }

  /**
   * Evaluate a metric value against a named alert rule.
   * Returns the AlertEvent if the threshold is breached, null otherwise.
   */
  evaluate(
    ruleName: string,
    value: number,
    tenantId?: string,
  ): AlertEvent | null {
    const rule = this.rules.get(ruleName);
    if (!rule) return null;

    // Check threshold
    if (value < rule.threshold) return null;

    // Deduplication: suppress duplicate alerts within the window
    const dedupeKey = `${ruleName}:${tenantId ?? 'global'}`;
    const lastFired = this.deduplicationWindow.get(dedupeKey);
    const now = Date.now();

    if (lastFired !== undefined && (now - lastFired) < this.deduplicationSeconds * 1000) {
      return null;
    }

    // Record the firing time
    this.deduplicationWindow.set(dedupeKey, now);

    return {
      ruleName: rule.name,
      severity: rule.severity,
      description: rule.description,
      value,
      threshold: rule.threshold,
      timestamp: new Date(),
      tenantId,
      channels: rule.channels,
    };
  }

  /**
   * Fire an alert: evaluate the rule and send notifications to all configured channels.
   */
  async fire(
    ruleName: string,
    value: number,
    tenantId?: string,
  ): Promise<AlertEvent | null> {
    const event = this.evaluate(ruleName, value, tenantId);
    if (!event) return null;

    // Send to all channels configured for this rule
    const notifyPromises = event.channels.map(async (channel) => {
      const notifier = this.notifiers.get(channel);
      if (notifier) {
        await notifier.notify(event);
      }
    });

    await Promise.allSettled(notifyPromises);
    return event;
  }

  // ── Introspection ────────────────────────────────────────────

  getRule(name: string): AlertRule | undefined {
    return this.rules.get(name);
  }

  getRuleNames(): readonly string[] {
    return [...this.rules.keys()];
  }

  getRuleCount(): number {
    return this.rules.size;
  }

  /**
   * Get the default routing channels for a severity level.
   */
  static getRoutingForSeverity(severity: AlertSeverity): readonly AlertChannel[] {
    return SEVERITY_ROUTING[severity];
  }

  /**
   * Clear the deduplication window — for testing only.
   */
  clearDeduplication(): void {
    this.deduplicationWindow.clear();
  }
}

export { PREDEFINED_ALERTS, SEVERITY_ROUTING };
