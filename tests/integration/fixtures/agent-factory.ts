/**
 * Agent data factories — synthetic agent sessions and actions.
 *
 * SECURITY: No real PHI — all prompts and context are synthetic.
 */

import { randomUUID } from 'node:crypto';

export interface MockAgentSession {
  readonly id: string;
  readonly tenantId: string;
  readonly agentRole: string;
  readonly userId: string;
  readonly tools: readonly string[];
  readonly confidenceThreshold: number;
  readonly budget: {
    readonly maxTokens: number;
    readonly maxCostCents: number;
    readonly maxActions: number;
  };
  readonly status: string;
  readonly createdAt: Date;
}

export interface MockAgentAction {
  readonly id: string;
  readonly sessionId: string;
  readonly tenantId: string;
  readonly toolName: string;
  readonly input: Record<string, unknown>;
  readonly output: Record<string, unknown>;
  readonly confidence: number;
  readonly tokensUsed: number;
  readonly costCents: number;
  readonly durationMs: number;
  readonly timestamp: Date;
}

const AGENT_ROLES = [
  'lead_qualifier',
  'follow_up',
  'collections',
  'support_triage',
  'churn_detection',
] as const;

const TOOL_SETS: Record<string, readonly string[]> = {
  lead_qualifier: ['search_crm', 'score_lead', 'send_email'],
  follow_up: ['read_history', 'send_sms', 'schedule_callback'],
  collections: ['check_balance', 'offer_payment_plan', 'send_sms'],
  support_triage: ['search_kb', 'classify_ticket', 'route_agent'],
  churn_detection: ['analyze_usage', 'compute_health', 'escalate'],
} as const;

let sessionCounter = 0;
let actionCounter = 0;

export function createMockAgentSession(
  role?: string,
  overrides?: Partial<MockAgentSession>,
): MockAgentSession {
  sessionCounter += 1;
  const selectedRole = role ?? AGENT_ROLES[sessionCounter % AGENT_ROLES.length]!;
  const tools = TOOL_SETS[selectedRole] ?? ['default_tool'];

  return {
    id: overrides?.id ?? `ses_${randomUUID().slice(0, 8)}`,
    tenantId: overrides?.tenantId ?? 'tnt_test',
    agentRole: selectedRole,
    userId: overrides?.userId ?? `usr_${randomUUID().slice(0, 8)}`,
    tools,
    confidenceThreshold: overrides?.confidenceThreshold ?? 0.7,
    budget: overrides?.budget ?? {
      maxTokens: 50_000,
      maxCostCents: 100,
      maxActions: 20,
    },
    status: overrides?.status ?? 'active',
    createdAt: overrides?.createdAt ?? new Date('2026-01-15T10:00:00.000Z'),
  };
}

export function createMockAgentAction(
  sessionId: string,
  overrides?: Partial<MockAgentAction>,
): MockAgentAction {
  actionCounter += 1;

  return {
    id: overrides?.id ?? `act_${randomUUID().slice(0, 8)}`,
    sessionId,
    tenantId: overrides?.tenantId ?? 'tnt_test',
    toolName: overrides?.toolName ?? 'default_tool',
    input: overrides?.input ?? { query: `test-input-${actionCounter}` },
    output: overrides?.output ?? { result: `test-output-${actionCounter}` },
    confidence: overrides?.confidence ?? 0.85,
    tokensUsed: overrides?.tokensUsed ?? 150 + actionCounter * 10,
    costCents: overrides?.costCents ?? 1,
    durationMs: overrides?.durationMs ?? 200 + actionCounter * 50,
    timestamp: overrides?.timestamp ?? new Date('2026-01-15T10:01:00.000Z'),
  };
}
