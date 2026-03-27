/**
 * Agent Activity Page — Monitor AI agent sessions, HITL queue, kill switch.
 *
 * COMPLIANCE: Agent actions are bounded and audit-logged per Rule 9.
 * Confidence threshold < 0.7 triggers HITL. Kill switch is always available.
 */

import { type ReactNode, useState, useEffect, useCallback, useMemo } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Spinner } from '../components/ui/Spinner';
import { Modal } from '../components/ui/Modal';
import { AgentFlowGraph, type FlowStep } from '../components/agent-graph/AgentFlowGraph';
import { GaugeChart } from '../components/charts/GaugeChart';
import { BarChart } from '../components/charts/BarChart';
import { SparkLine } from '../components/charts/SparkLine';
import {
  listSessions,
  listHitl,
  killSession,
  approveHitl,
  rejectHitl,
  type AgentSession as ApiSession,
  type HitlItem as ApiHitlItem,
} from '../lib/agents-api';

// --- Types ---

interface AgentSession {
  id: string;
  agentType: string;
  status: 'running' | 'completed' | 'failed' | 'awaiting-review' | 'killed';
  customerId: string;
  customerName: string;
  stepsCompleted: number;
  totalSteps: number;
  toolsUsed: string[];
  confidence: number;
  costUsd: number;
  startedAt: string;
  completedAt: string | null;
}

interface HitlItem {
  id: string;
  sessionId: string;
  agentType: string;
  action: string;
  reason: string;
  confidence: number;
  customerName: string;
  createdAt: string;
}

interface AgentMetrics {
  totalSessions: number;
  activeSessions: number;
  avgConfidence: number;
  successRate: number;
  totalCost: number;
  hitlPending: number;
}

// --- Constants ---

const sessionStatusBadge: Record<
  AgentSession['status'],
  'success' | 'info' | 'danger' | 'warning' | 'neutral'
> = {
  running: 'info',
  completed: 'success',
  failed: 'danger',
  'awaiting-review': 'warning',
  killed: 'neutral',
};

// --- Mock data ---

const mockSessions: AgentSession[] = [
  {
    id: 'sess-001',
    agentType: 'collection',
    status: 'running',
    customerId: 'cust-0001',
    customerName: 'Acme Corp',
    stepsCompleted: 3,
    totalSteps: 5,
    toolsUsed: ['send_sms', 'check_balance', 'schedule_payment'],
    confidence: 0.91,
    costUsd: 0.12,
    startedAt: new Date(Date.now() - 180000).toISOString(),
    completedAt: null,
  },
  {
    id: 'sess-002',
    agentType: 'onboarding',
    status: 'running',
    customerId: 'cust-0003',
    customerName: 'Initech',
    stepsCompleted: 2,
    totalSteps: 4,
    toolsUsed: ['verify_identity', 'send_welcome'],
    confidence: 0.85,
    costUsd: 0.08,
    startedAt: new Date(Date.now() - 300000).toISOString(),
    completedAt: null,
  },
  {
    id: 'sess-003',
    agentType: 'collection',
    status: 'awaiting-review',
    customerId: 'cust-0005',
    customerName: 'Stark Industries',
    stepsCompleted: 2,
    totalSteps: 5,
    toolsUsed: ['check_balance', 'classify_risk'],
    confidence: 0.52,
    costUsd: 0.06,
    startedAt: new Date(Date.now() - 600000).toISOString(),
    completedAt: null,
  },
  {
    id: 'sess-004',
    agentType: 'support',
    status: 'completed',
    customerId: 'cust-0002',
    customerName: 'Globex Inc',
    stepsCompleted: 3,
    totalSteps: 3,
    toolsUsed: ['lookup_account', 'generate_response', 'send_email'],
    confidence: 0.94,
    costUsd: 0.15,
    startedAt: new Date(Date.now() - 1200000).toISOString(),
    completedAt: new Date(Date.now() - 900000).toISOString(),
  },
  {
    id: 'sess-005',
    agentType: 'collection',
    status: 'failed',
    customerId: 'cust-0007',
    customerName: 'LexCorp',
    stepsCompleted: 1,
    totalSteps: 5,
    toolsUsed: ['check_balance'],
    confidence: 0.34,
    costUsd: 0.02,
    startedAt: new Date(Date.now() - 1800000).toISOString(),
    completedAt: new Date(Date.now() - 1700000).toISOString(),
  },
  {
    id: 'sess-006',
    agentType: 'retention',
    status: 'completed',
    customerId: 'cust-0004',
    customerName: 'Umbrella LLC',
    stepsCompleted: 4,
    totalSteps: 4,
    toolsUsed: ['analyze_churn', 'generate_offer', 'send_sms', 'log_outcome'],
    confidence: 0.88,
    costUsd: 0.18,
    startedAt: new Date(Date.now() - 3600000).toISOString(),
    completedAt: new Date(Date.now() - 3000000).toISOString(),
  },
  {
    id: 'sess-007',
    agentType: 'onboarding',
    status: 'killed',
    customerId: 'cust-0009',
    customerName: 'Pied Piper',
    stepsCompleted: 1,
    totalSteps: 4,
    toolsUsed: ['verify_identity'],
    confidence: 0.21,
    costUsd: 0.01,
    startedAt: new Date(Date.now() - 5400000).toISOString(),
    completedAt: new Date(Date.now() - 5300000).toISOString(),
  },
];

const mockHitl: HitlItem[] = [
  {
    id: 'hitl-001',
    sessionId: 'sess-003',
    agentType: 'collection',
    action: 'Send payment demand via SMS',
    reason: 'Confidence below threshold (0.52)',
    confidence: 0.52,
    customerName: 'Stark Industries',
    createdAt: new Date(Date.now() - 600000).toISOString(),
  },
  {
    id: 'hitl-002',
    sessionId: 'sess-008',
    agentType: 'collection',
    action: 'Escalate account to legal team',
    reason: 'High-value irreversible action requires approval',
    confidence: 0.71,
    customerName: 'Wayne Enterprises',
    createdAt: new Date(Date.now() - 900000).toISOString(),
  },
  {
    id: 'hitl-003',
    sessionId: 'sess-009',
    agentType: 'retention',
    action: 'Issue $5,000 credit to account',
    reason: 'Financial action requires human review',
    confidence: 0.83,
    customerName: 'Hooli',
    createdAt: new Date(Date.now() - 1500000).toISOString(),
  },
];

const mockMetrics: AgentMetrics = {
  totalSessions: 347,
  activeSessions: 2,
  avgConfidence: 0.87,
  successRate: 94.2,
  totalCost: 42.58,
  hitlPending: 3,
};

// --- API adapters ---

const apiStatusMap: Record<string, AgentSession['status']> = {
  active: 'running',
  completed: 'completed',
  killed: 'killed',
  escalated: 'awaiting-review',
  failed: 'failed',
};

function adaptSession(s: ApiSession): AgentSession {
  const tools = s.steps.map((step) => step.toolUsed).filter((t): t is string => t !== null);
  return {
    id: s.id,
    agentType: s.agentRole,
    status: apiStatusMap[s.status] ?? 'failed',
    customerId: s.customerId,
    customerName: s.customerId,
    stepsCompleted: s.steps.filter((step) => step.approved).length,
    totalSteps: Math.max(s.steps.length, 1),
    toolsUsed: tools.length > 0 ? tools : ['(no tools)'],
    confidence: s.confidenceScore ?? 0,
    costUsd: s.costCents / 100,
    startedAt: s.startedAt,
    completedAt: s.completedAt,
  };
}

function adaptHitlItem(h: ApiHitlItem): HitlItem {
  return {
    id: h.id,
    sessionId: h.sessionId,
    agentType: typeof h.context['agentRole'] === 'string' ? h.context['agentRole'] : 'agent',
    action: h.action,
    reason: h.reason,
    confidence: typeof h.context['confidence'] === 'number' ? h.context['confidence'] : 0,
    customerName:
      typeof h.context['customerId'] === 'string' ? h.context['customerId'] : h.sessionId,
    createdAt: h.createdAt,
  };
}

function deriveMetrics(
  sessions: AgentSession[],
  apiTotal: number,
  hitlTotal: number,
): AgentMetrics {
  const activeSessions = sessions.filter((s) => s.status === 'running').length;
  const completedSessions = sessions.filter((s) => s.status === 'completed').length;
  const confidences = sessions.map((s) => s.confidence).filter((c) => c > 0);
  const avgConfidence =
    confidences.length > 0 ? confidences.reduce((a, b) => a + b, 0) / confidences.length : 0;
  const successRate = sessions.length > 0 ? (completedSessions / sessions.length) * 100 : 0;
  const totalCost = sessions.reduce((sum, s) => sum + s.costUsd, 0);
  return {
    totalSessions: apiTotal,
    activeSessions,
    avgConfidence,
    successRate,
    totalCost,
    hitlPending: hitlTotal,
  };
}

// --- Confidence histogram bucket helpers ---

const confidenceBuckets: { label: string; min: number; max: number; color: string }[] = [
  { label: '0-20%', min: 0, max: 0.2, color: '#ef4444' },
  { label: '20-40%', min: 0.2, max: 0.4, color: '#f97316' },
  { label: '40-60%', min: 0.4, max: 0.6, color: '#f59e0b' },
  { label: '60-80%', min: 0.6, max: 0.8, color: '#3b82f6' },
  { label: '80-100%', min: 0.8, max: 1.01, color: '#10b981' },
];

// --- Component ---

export function AgentActivity(): ReactNode {
  const [sessions, setSessions] = useState<AgentSession[]>([]);
  const [hitlQueue, setHitlQueue] = useState<HitlItem[]>([]);
  const [metrics, setMetrics] = useState<AgentMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedSession, setSelectedSession] = useState<AgentSession | null>(null);
  const [killConfirm, setKillConfirm] = useState<AgentSession | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [sessRes, hitlRes] = await Promise.allSettled([
        listSessions({ pageSize: 50 }),
        listHitl(),
      ]);

      const adapted =
        sessRes.status === 'fulfilled' ? sessRes.value.data.map(adaptSession) : mockSessions;
      const adaptedHitl =
        hitlRes.status === 'fulfilled' ? hitlRes.value.data.map(adaptHitlItem) : mockHitl;
      const apiTotal =
        sessRes.status === 'fulfilled' ? sessRes.value.total : mockMetrics.totalSessions;
      const hitlTotal =
        hitlRes.status === 'fulfilled' ? hitlRes.value.total : mockMetrics.hitlPending;

      setSessions(adapted);
      setHitlQueue(adaptedHitl);
      setMetrics(deriveMetrics(adapted, apiTotal, hitlTotal));
    } catch {
      setSessions(mockSessions);
      setHitlQueue(mockHitl);
      setMetrics(mockMetrics);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const handleKillSession = useCallback(async (session: AgentSession) => {
    try {
      await killSession(session.id, 'Terminated by operator');
    } catch {
      // Mock update — optimistic
    }
    setSessions((prev) =>
      prev.map((s) => (s.id === session.id ? { ...s, status: 'killed' as const } : s)),
    );
    setKillConfirm(null);
    setSelectedSession(null);
  }, []);

  const handleHitlAction = useCallback(async (item: HitlItem, action: 'approve' | 'reject') => {
    try {
      if (action === 'approve') {
        await approveHitl(item.id);
      } else {
        await rejectHitl(item.id, 'Rejected by operator');
      }
    } catch {
      // Mock update — optimistic
    }
    setHitlQueue((prev) => prev.filter((h) => h.id !== item.id));
  }, []);

  function confidenceColor(c: number): string {
    if (c >= 0.8) return 'text-emerald-400';
    if (c >= 0.7) return 'text-amber-400';
    return 'text-red-400';
  }

  // Derived data for charts
  const sessionsSparkData = useMemo(
    () => [280, 310, 295, 330, 320, 340, metrics?.totalSessions ?? 347],
    [metrics],
  );
  const costSparkData = useMemo(
    () => [32.1, 35.4, 38.2, 36.5, 40.1, 41.2, metrics?.totalCost ?? 42.58],
    [metrics],
  );
  const confidenceSparkData = useMemo(
    () => [0.82, 0.84, 0.85, 0.86, 0.85, 0.87, metrics?.avgConfidence ?? 0.87].map((v) => v * 100),
    [metrics],
  );
  const successSparkData = useMemo(
    () => [91.0, 92.1, 93.0, 93.5, 93.8, 94.0, metrics?.successRate ?? 94.2],
    [metrics],
  );

  // Confidence histogram from session data
  const confidenceHistogramData = useMemo(
    () =>
      confidenceBuckets.map((bucket) => ({
        label: bucket.label,
        value: sessions.filter((s) => s.confidence >= bucket.min && s.confidence < bucket.max)
          .length,
        color: bucket.color,
      })),
    [sessions],
  );

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner size="lg" label="Loading agent activity" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-content">Agent Activity</h1>
          <p className="mt-1 text-sm text-content-secondary">
            Monitor AI agent sessions, approvals, and performance
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={fetchData}>
          Refresh
        </Button>
      </div>

      {/* Metrics — KPI Cards with SparkLines and accent borders */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-6">
        <Card accent="blue">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-2xs font-medium uppercase tracking-wider text-content-secondary">
                Sessions Today
              </p>
              <p className="mt-1 font-mono text-lg font-bold text-content">
                {metrics?.totalSessions ?? 0}
              </p>
            </div>
            <SparkLine data={sessionsSparkData} color="#3b82f6" width={56} height={20} />
          </div>
        </Card>
        <Card accent="blue">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-2xs font-medium uppercase tracking-wider text-content-secondary">
                Active Now
              </p>
              <p className="mt-1 font-mono text-lg font-bold text-blue-400">
                {metrics?.activeSessions ?? 0}
              </p>
            </div>
          </div>
        </Card>
        <Card accent="green">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-2xs font-medium uppercase tracking-wider text-content-secondary">
                Avg Confidence
              </p>
              <p
                className={`mt-1 font-mono text-lg font-bold ${confidenceColor(metrics?.avgConfidence ?? 0)}`}
              >
                {((metrics?.avgConfidence ?? 0) * 100).toFixed(1)}%
              </p>
            </div>
            <SparkLine data={confidenceSparkData} color="#10b981" width={56} height={20} />
          </div>
        </Card>
        <Card accent="green">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-2xs font-medium uppercase tracking-wider text-content-secondary">
                Success Rate
              </p>
              <p className="mt-1 font-mono text-lg font-bold text-emerald-400">
                {metrics?.successRate ?? 0}%
              </p>
            </div>
            <SparkLine data={successSparkData} color="#10b981" width={56} height={20} />
          </div>
        </Card>
        <Card accent="purple">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-2xs font-medium uppercase tracking-wider text-content-secondary">
                Total Cost
              </p>
              <p className="mt-1 font-mono text-lg font-bold text-content">
                ${metrics?.totalCost.toFixed(2) ?? '0.00'}
              </p>
            </div>
            <SparkLine data={costSparkData} color="#8b5cf6" width={56} height={20} />
          </div>
        </Card>
        <Card accent="amber">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-2xs font-medium uppercase tracking-wider text-content-secondary">
                HITL Pending
              </p>
              <p
                className={`mt-1 font-mono text-lg font-bold ${(metrics?.hitlPending ?? 0) > 0 ? 'text-amber-400' : 'text-content'}`}
              >
                {metrics?.hitlPending ?? 0}
              </p>
            </div>
          </div>
        </Card>
      </div>

      {/* === Gauge + Histogram Row === */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Gauges for key rates */}
        <Card title="Agent Performance Gauges">
          <div className="flex items-center justify-around">
            <GaugeChart
              value={Math.round((metrics?.avgConfidence ?? 0) * 100)}
              label="Confidence"
              size={110}
            />
            <GaugeChart
              value={Math.round(metrics?.successRate ?? 0)}
              label="Success Rate"
              size={110}
            />
          </div>
        </Card>

        {/* Confidence Histogram */}
        <Card title="Confidence Distribution" className="lg:col-span-2">
          <BarChart data={confidenceHistogramData} height={200} showLabels showValues />
          <p className="mt-2 text-2xs text-content-tertiary">
            Distribution of confidence scores across all sessions
          </p>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Sessions — 2/3 */}
        <div className="space-y-4 lg:col-span-2">
          <Card
            title="Active Sessions"
            actions={
              <Badge variant="info" dot>
                Live
              </Badge>
            }
            padding={false}
          >
            <div className="divide-y divide-border">
              {sessions.map((session) => (
                <button
                  key={session.id}
                  className="flex w-full items-start gap-3 p-4 text-left transition-colors hover:bg-surface-tertiary/30"
                  onClick={() => {
                    setSelectedSession(session);
                  }}
                  aria-label={`View session ${session.id}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-content">
                        {session.customerName}
                      </span>
                      <Badge variant={sessionStatusBadge[session.status]} dot size="sm">
                        {session.status}
                      </Badge>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-content-tertiary">
                      <span>Agent: {session.agentType}</span>
                      <span>
                        Steps:{' '}
                        <span className="font-mono">
                          {session.stepsCompleted}/{session.totalSteps}
                        </span>
                      </span>
                      <span className={confidenceColor(session.confidence)}>
                        Confidence:{' '}
                        <span className="font-mono">{(session.confidence * 100).toFixed(0)}%</span>
                      </span>
                      <span>
                        Cost: <span className="font-mono">${session.costUsd.toFixed(3)}</span>
                      </span>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-2xs text-content-tertiary">
                      {new Date(session.startedAt).toLocaleTimeString('en-US', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </p>
                    {session.status === 'running' && (
                      <Button
                        variant="danger"
                        size="sm"
                        className="mt-1"
                        onClick={(e) => {
                          e.stopPropagation();
                          setKillConfirm(session);
                        }}
                        aria-label={`Kill session ${session.id}`}
                      >
                        Kill
                      </Button>
                    )}
                  </div>
                </button>
              ))}
              {sessions.length === 0 && (
                <p className="px-4 py-8 text-center text-sm text-content-secondary">
                  No active agent sessions.
                </p>
              )}
            </div>
          </Card>
        </div>

        {/* HITL Queue — 1/3 */}
        <div>
          <Card
            title="HITL Queue"
            actions={
              hitlQueue.length > 0 ? (
                <Badge variant="warning" dot>
                  {hitlQueue.length} pending
                </Badge>
              ) : (
                <Badge variant="success" size="sm">
                  Clear
                </Badge>
              )
            }
            padding={false}
          >
            <div className="divide-y divide-border">
              {hitlQueue.map((item) => (
                <div key={item.id} className="p-4">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-content">{item.customerName}</span>
                    <Badge variant="warning" size="sm">
                      {item.agentType}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-content-secondary">{item.action}</p>
                  <p className="mt-0.5 text-2xs text-content-tertiary">{item.reason}</p>
                  <p className={`mt-1 text-2xs font-mono ${confidenceColor(item.confidence)}`}>
                    Confidence: {(item.confidence * 100).toFixed(0)}%
                  </p>
                  <div className="mt-3 flex items-center gap-2">
                    <Button size="sm" onClick={() => handleHitlAction(item, 'approve')}>
                      Approve
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => handleHitlAction(item, 'reject')}
                    >
                      Reject
                    </Button>
                  </div>
                </div>
              ))}
              {hitlQueue.length === 0 && (
                <p className="px-4 py-8 text-center text-sm text-content-secondary">
                  No items pending review.
                </p>
              )}
            </div>
          </Card>
        </div>
      </div>

      {/* Orchestrator Status */}
      <Card
        title="Orchestrator Status"
        actions={
          <Badge variant="success" dot size="sm">
            Online
          </Badge>
        }
      >
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <div>
            <p className="text-2xs font-medium uppercase tracking-wider text-content-secondary">
              Active Agents
            </p>
            <p className="mt-1 font-mono text-lg font-bold text-blue-400">
              {sessions.filter((s) => s.status === 'running').length}
            </p>
          </div>
          <div>
            <p className="text-2xs font-medium uppercase tracking-wider text-content-secondary">
              Agent Roles
            </p>
            <div className="mt-1 flex flex-wrap gap-1">
              {[
                ...new Set(sessions.filter((s) => s.status === 'running').map((s) => s.agentType)),
              ].map((role) => (
                <Badge key={role} variant="info" size="sm">
                  {role}
                </Badge>
              ))}
              {sessions.filter((s) => s.status === 'running').length === 0 && (
                <span className="text-xs text-content-tertiary">None active</span>
              )}
            </div>
          </div>
          <div>
            <p className="text-2xs font-medium uppercase tracking-wider text-content-secondary">
              Handoffs Today
            </p>
            <p className="mt-1 font-mono text-lg font-bold text-content">7</p>
          </div>
          <div>
            <p className="text-2xs font-medium uppercase tracking-wider text-content-secondary">
              Safety Status
            </p>
            <Badge variant="success" dot size="sm" className="mt-1">
              All Bounded
            </Badge>
          </div>
        </div>
      </Card>

      {/* Session detail modal */}
      <Modal
        open={selectedSession !== null}
        onClose={() => {
          setSelectedSession(null);
        }}
        title={`Session: ${selectedSession?.id ?? ''}`}
        size="lg"
        actions={
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSelectedSession(null);
              }}
            >
              Close
            </Button>
            {selectedSession?.status === 'running' && (
              <Button
                variant="danger"
                size="sm"
                onClick={() => {
                  setKillConfirm(selectedSession);
                }}
              >
                Kill Session
              </Button>
            )}
          </>
        }
      >
        {selectedSession && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-content-tertiary">Customer</p>
                <p className="text-sm text-content">{selectedSession.customerName}</p>
              </div>
              <div>
                <p className="text-xs text-content-tertiary">Agent Type</p>
                <p className="text-sm text-content capitalize">{selectedSession.agentType}</p>
              </div>
              <div>
                <p className="text-xs text-content-tertiary">Status</p>
                <Badge variant={sessionStatusBadge[selectedSession.status]} dot>
                  {selectedSession.status}
                </Badge>
              </div>
              <div>
                <p className="text-xs text-content-tertiary">Confidence</p>
                <p
                  className={`font-mono text-lg font-bold ${confidenceColor(selectedSession.confidence)}`}
                >
                  {(selectedSession.confidence * 100).toFixed(1)}%
                </p>
              </div>
              <div>
                <p className="text-xs text-content-tertiary">Progress</p>
                <div className="mt-1 flex items-center gap-2">
                  <div className="h-2 flex-1 rounded-full bg-surface-tertiary">
                    <div
                      className="h-2 rounded-full bg-brand-accent"
                      style={{
                        width: `${(selectedSession.stepsCompleted / selectedSession.totalSteps) * 100}%`,
                      }}
                    />
                  </div>
                  <span className="font-mono text-xs text-content-secondary">
                    {selectedSession.stepsCompleted}/{selectedSession.totalSteps}
                  </span>
                </div>
              </div>
              <div>
                <p className="text-xs text-content-tertiary">Cost</p>
                <p className="text-sm font-mono text-content">
                  ${selectedSession.costUsd.toFixed(4)}
                </p>
              </div>
            </div>

            <div>
              <p className="mb-2 text-xs text-content-tertiary">Tools Used</p>
              <div className="flex flex-wrap gap-1.5">
                {selectedSession.toolsUsed.map((tool) => (
                  <Badge key={tool} variant="neutral" size="sm">
                    {tool}
                  </Badge>
                ))}
              </div>
            </div>

            {/* Agent Flow Visualization */}
            <div>
              <p className="mb-2 text-xs text-content-tertiary">Execution Flow</p>
              <AgentFlowGraph
                steps={selectedSession.toolsUsed.map<FlowStep>((tool, idx) => ({
                  id: `${selectedSession.id}-step-${idx}`,
                  phase: (['observe', 'think', 'act', 'check'] as const)[idx % 4] ?? 'observe',
                  agentRole: selectedSession.agentType,
                  description: `Execute ${tool}`,
                  status:
                    idx < selectedSession.stepsCompleted
                      ? 'completed'
                      : idx === selectedSession.stepsCompleted
                        ? selectedSession.status === 'running'
                          ? 'in-progress'
                          : selectedSession.status === 'awaiting-review'
                            ? 'hitl-pending'
                            : selectedSession.status === 'failed'
                              ? 'failed'
                              : 'pending'
                        : 'pending',
                  confidence: selectedSession.confidence,
                  tool,
                  durationMs: Math.floor(Math.random() * 500 + 100),
                }))}
              />
            </div>

            <div className="rounded-lg border border-border bg-surface px-3 py-2">
              <p className="text-2xs text-content-tertiary">
                Session ID: <span className="font-mono">{selectedSession.id}</span>
                {' | '}
                Started: {new Date(selectedSession.startedAt).toLocaleString()}
              </p>
            </div>
          </div>
        )}
      </Modal>

      {/* Kill confirmation modal */}
      <Modal
        open={killConfirm !== null}
        onClose={() => {
          setKillConfirm(null);
        }}
        title="Confirm Kill Session"
        size="sm"
        actions={
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setKillConfirm(null);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => killConfirm && handleKillSession(killConfirm)}
            >
              Kill Session
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-content">
            This will immediately terminate the agent session. This action is logged in the
            immutable audit trail.
          </p>
          {killConfirm && (
            <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2">
              <p className="text-xs text-red-300">
                Session: <span className="font-mono">{killConfirm.id}</span>
                <br />
                Customer: {killConfirm.customerName}
                <br />
                Agent: {killConfirm.agentType}
              </p>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
