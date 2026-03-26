import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isOk, isErr, ok, err, InternalError, ValidationError } from '@ordr/core';
import type {
  RouterSentimentProvider,
  SentimentHistoryProvider,
  RoutingAuditLogger,
} from '../routing/sentiment-router.js';
import { SentimentRouter, ROUTING_ACTIONS } from '../routing/sentiment-router.js';
import type { SentimentResult } from '../sentiment.js';

// ─── Mock Factories ─────────────────────────────────────────────

function createMockSentimentProvider(score: number = 0.0, confidence: number = 0.9): RouterSentimentProvider {
  const label = score < -0.2 ? 'negative' : score > 0.2 ? 'positive' : 'neutral';
  return {
    analyze: vi.fn().mockResolvedValue(ok({
      score,
      label,
      confidence,
    } satisfies SentimentResult)),
  };
}

function createMockHistoryProvider(history: SentimentResult[] = []): SentimentHistoryProvider {
  return {
    getRecent: vi.fn().mockResolvedValue(ok(history)),
  };
}

function createMockAuditLogger(): RoutingAuditLogger {
  return vi.fn();
}

const TENANT_ID = 'tenant-abc';

function createRouter(overrides: {
  sentimentScore?: number;
  confidence?: number;
  history?: SentimentResult[];
  sentimentProvider?: RouterSentimentProvider;
  historyProvider?: SentimentHistoryProvider;
  auditLog?: RoutingAuditLogger;
} = {}): SentimentRouter {
  return new SentimentRouter({
    sentimentProvider: overrides.sentimentProvider ?? createMockSentimentProvider(overrides.sentimentScore ?? 0.0, overrides.confidence ?? 0.9),
    historyProvider: overrides.historyProvider ?? createMockHistoryProvider(overrides.history ?? []),
    auditLog: overrides.auditLog ?? createMockAuditLogger(),
    tenantId: TENANT_ID,
  });
}

// ─── Routing Decision Tests ─────────────────────────────────────

describe('SentimentRouter.route', () => {
  // ── Very Negative (< -0.6) → Escalate to Human ────────

  it('routes very negative sentiment to human operator', async () => {
    const router = createRouter({ sentimentScore: -0.8 });
    const result = await router.route('cust-1', 'I am furious!', 'support_agent');
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.action).toBe('escalate_human');
      expect(result.data.targetAgent).toBe('human_operator');
    }
  });

  it('routes score of -0.7 to human operator', async () => {
    const router = createRouter({ sentimentScore: -0.7 });
    const result = await router.route('cust-1', 'Very upset', 'support_agent');
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.action).toBe('escalate_human');
    }
  });

  it('routes score of exactly -0.6 to retention agent (boundary)', async () => {
    // Score exactly at -0.6 is NOT less than -0.6, so goes to next bucket
    const router = createRouter({ sentimentScore: -0.6 });
    const result = await router.route('cust-1', 'Unhappy', 'support_agent');
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.action).toBe('route_retention');
    }
  });

  // ── Negative (-0.6 to -0.2) → Route to Retention ─────

  it('routes negative sentiment to retention agent', async () => {
    const router = createRouter({ sentimentScore: -0.4 });
    const result = await router.route('cust-1', 'Disappointed', 'support_agent');
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.action).toBe('route_retention');
      expect(result.data.targetAgent).toBe('retention_agent');
    }
  });

  it('routes score of -0.3 to retention agent', async () => {
    const router = createRouter({ sentimentScore: -0.3 });
    const result = await router.route('cust-1', 'Not great', 'support_agent');
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.action).toBe('route_retention');
    }
  });

  // ── Neutral (-0.2 to 0.4) → Keep Current ─────────────

  it('keeps current agent for neutral sentiment', async () => {
    const router = createRouter({ sentimentScore: 0.1 });
    const result = await router.route('cust-1', 'Just checking in', 'support_agent');
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.action).toBe('keep_current');
      expect(result.data.targetAgent).toBe('support_agent');
    }
  });

  it('keeps current agent for score of 0.0', async () => {
    const router = createRouter({ sentimentScore: 0.0 });
    const result = await router.route('cust-1', 'Status update', 'billing_agent');
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.action).toBe('keep_current');
      expect(result.data.targetAgent).toBe('billing_agent');
    }
  });

  it('keeps current agent for score at -0.2 boundary', async () => {
    const router = createRouter({ sentimentScore: -0.2 });
    const result = await router.route('cust-1', 'Meh', 'support_agent');
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.action).toBe('keep_current');
    }
  });

  it('keeps current agent for score at 0.4 boundary', async () => {
    const router = createRouter({ sentimentScore: 0.4 });
    const result = await router.route('cust-1', 'OK', 'support_agent');
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.action).toBe('keep_current');
    }
  });

  // ── Positive (> 0.4) → Route to Growth ────────────────

  it('routes positive sentiment to growth agent', async () => {
    const router = createRouter({ sentimentScore: 0.7 });
    const result = await router.route('cust-1', 'Love this product!', 'support_agent');
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.action).toBe('route_growth');
      expect(result.data.targetAgent).toBe('growth_agent');
    }
  });

  it('routes score of 0.5 to growth agent', async () => {
    const router = createRouter({ sentimentScore: 0.5 });
    const result = await router.route('cust-1', 'Happy', 'support_agent');
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.action).toBe('route_growth');
    }
  });

  // ── Historical Trend Consideration ────────────────────

  it('considers historical sentiment trend — improving', async () => {
    const history: SentimentResult[] = [
      { score: -0.5, label: 'negative', confidence: 0.9 },
      { score: -0.3, label: 'negative', confidence: 0.9 },
      { score: -0.1, label: 'neutral', confidence: 0.9 },
    ];
    const router = createRouter({ sentimentScore: 0.3, history });
    const result = await router.route('cust-1', 'Getting better', 'support_agent');
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.trendDirection).toBe('improving');
    }
  });

  it('considers historical sentiment trend — declining', async () => {
    const history: SentimentResult[] = [
      { score: 0.8, label: 'positive', confidence: 0.9 },
      { score: 0.6, label: 'positive', confidence: 0.9 },
      { score: 0.5, label: 'positive', confidence: 0.9 },
    ];
    const router = createRouter({ sentimentScore: 0.1, history });
    const result = await router.route('cust-1', 'Not as good', 'support_agent');
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.trendDirection).toBe('declining');
    }
  });

  it('returns stable trend when no history exists', async () => {
    const router = createRouter({ sentimentScore: 0.0, history: [] });
    const result = await router.route('cust-1', 'Hello', 'support_agent');
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.trendDirection).toBe('stable');
    }
  });

  it('handles missing history gracefully (provider fails)', async () => {
    const historyProvider: SentimentHistoryProvider = {
      getRecent: vi.fn().mockResolvedValue(err(new InternalError('DB down'))),
    };
    const router = createRouter({ sentimentScore: 0.0, historyProvider });
    const result = await router.route('cust-1', 'Test', 'support_agent');
    // Should still work — just without trend data
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.trendDirection).toBe('stable');
    }
  });

  // ── Audit Logging ─────────────────────────────────────

  it('audit-logs every routing decision', async () => {
    const auditLog = createMockAuditLogger();
    const router = createRouter({ sentimentScore: 0.5, auditLog });
    await router.route('cust-1', 'Happy message', 'support_agent');
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        customerId: 'cust-1',
        action: 'route_growth',
        fromAgent: 'support_agent',
        toAgent: 'growth_agent',
      }),
    );
  });

  it('audit log includes sentiment score', async () => {
    const auditLog = createMockAuditLogger();
    const router = createRouter({ sentimentScore: -0.8, auditLog });
    await router.route('cust-1', 'Angry', 'agent-x');
    const entry = (auditLog as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(entry.sentimentScore).toBe(-0.8);
  });

  it('audit log does NOT contain message content (PHI protection)', async () => {
    const auditLog = createMockAuditLogger();
    const router = createRouter({ sentimentScore: 0.0, auditLog });
    await router.route('cust-1', 'My SSN is 123-45-6789 and I am upset', 'agent-x');
    const entry = (auditLog as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(JSON.stringify(entry)).not.toContain('SSN');
    expect(JSON.stringify(entry)).not.toContain('123-45-6789');
  });

  // ── Input Validation ──────────────────────────────────

  it('returns ValidationError for empty customerId', async () => {
    const router = createRouter();
    const result = await router.route('', 'Hello', 'agent');
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.code).toBe('VALIDATION_FAILED');
  });

  it('returns ValidationError for empty message', async () => {
    const router = createRouter();
    const result = await router.route('cust-1', '', 'agent');
    expect(isErr(result)).toBe(true);
  });

  it('returns ValidationError for empty currentAgent', async () => {
    const router = createRouter();
    const result = await router.route('cust-1', 'Hello', '');
    expect(isErr(result)).toBe(true);
  });

  it('returns error when sentiment analysis fails', async () => {
    const sentimentProvider: RouterSentimentProvider = {
      analyze: vi.fn().mockResolvedValue(err(new InternalError('LLM down'))),
    };
    const router = createRouter({ sentimentProvider });
    const result = await router.route('cust-1', 'Hello', 'agent');
    expect(isErr(result)).toBe(true);
  });

  // ── Constants ─────────────────────────────────────────

  it('exports all routing actions', () => {
    expect(ROUTING_ACTIONS).toEqual([
      'escalate_human',
      'route_retention',
      'keep_current',
      'route_growth',
    ]);
  });

  it('includes confidence in routing decision', async () => {
    const router = createRouter({ sentimentScore: 0.5, confidence: 0.75 });
    const result = await router.route('cust-1', 'Nice', 'agent');
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.confidence).toBe(0.75);
    }
  });
});
