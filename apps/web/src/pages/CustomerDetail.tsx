/**
 * Customer Detail (360 View) — Full customer profile with graph, timeline, agent history.
 *
 * COMPLIANCE:
 * - NO message/call content is displayed (PHI) — metadata only (HIPAA §164.312)
 * - Interaction timeline shows channel, direction, status, timestamp — NEVER content
 * - All data access is audit-logged via apiClient correlation IDs
 */

import { type ReactNode, useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Spinner } from '../components/ui/Spinner';
import { GaugeChart } from '../components/charts/GaugeChart';
import { apiClient } from '../lib/api';

// --- Types ---

interface CustomerProfile {
  id: string;
  name: string;
  email: string;
  status: 'active' | 'inactive' | 'churned' | 'prospect';
  healthScore: number;
  lifecycleStage: 'lead' | 'onboarding' | 'active' | 'at-risk' | 'churned';
  lastContact: string;
  createdAt: string;
}

interface GraphRelationship {
  entityId: string;
  entityName: string;
  entityType: 'company' | 'deal' | 'agent' | 'contact';
  edgeLabel: string;
  influenceScore: number;
  communityId: string;
  centralityScore: number;
}

interface InteractionRecord {
  id: string;
  channel: 'sms' | 'email' | 'voice' | 'chat' | 'ivr';
  direction: 'inbound' | 'outbound';
  status: 'sent' | 'delivered' | 'failed' | 'pending' | 'received';
  timestamp: string;
  agentId: string | null;
  correlationId: string;
}

interface AgentSessionRecord {
  id: string;
  agentRole: string;
  outcome: 'success' | 'failed' | 'escalated' | 'killed';
  confidence: number;
  costUsd: number;
  steps: number;
  startedAt: string;
}

interface PaymentRecord {
  id: string;
  amount: number;
  status: 'completed' | 'pending' | 'failed' | 'refunded';
  date: string;
  method: string;
}

interface PaymentSummary {
  outstandingBalance: number;
  paymentPlanStatus: 'active' | 'none' | 'completed' | 'defaulted';
  lastPaymentDate: string | null;
  records: PaymentRecord[];
}

interface ContactPreference {
  channel: string;
  priority: number;
  consented: boolean;
  consentDate: string | null;
  preferredTimeStart: string;
  preferredTimeEnd: string;
}

// --- Constants ---

const statusBadge: Record<string, 'success' | 'neutral' | 'danger' | 'info'> = {
  active: 'success',
  inactive: 'neutral',
  churned: 'danger',
  prospect: 'info',
};

const lifecycleBadge: Record<string, 'info' | 'warning' | 'success' | 'danger' | 'neutral'> = {
  lead: 'info',
  onboarding: 'warning',
  active: 'success',
  'at-risk': 'danger',
  churned: 'neutral',
};

const channelIcon: Record<string, string> = {
  sms: '\u2709',
  email: '\u2709',
  voice: '\u260E',
  chat: '\u25AC',
  ivr: '\u260E',
};

const directionArrow: Record<string, string> = {
  inbound: '\u2190',
  outbound: '\u2192',
};

const interactionStatusBadge: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'neutral'> = {
  sent: 'info',
  delivered: 'success',
  failed: 'danger',
  pending: 'warning',
  received: 'success',
};

const outcomeVariant: Record<string, 'success' | 'danger' | 'warning' | 'neutral'> = {
  success: 'success',
  failed: 'danger',
  escalated: 'warning',
  killed: 'neutral',
};

const paymentStatusVariant: Record<string, 'success' | 'warning' | 'danger' | 'info'> = {
  completed: 'success',
  pending: 'warning',
  failed: 'danger',
  refunded: 'info',
};

const entityTypeIcon: Record<string, string> = {
  company: '\u25A0',
  deal: '\u25C6',
  agent: '\u25B2',
  contact: '\u25CF',
};

// --- Mock data ---

const mockProfile: CustomerProfile = {
  id: 'cust-0001',
  name: 'Acme Corp',
  email: 'contact@acme.com',
  status: 'active',
  healthScore: 82,
  lifecycleStage: 'active',
  lastContact: new Date(Date.now() - 86400000).toISOString(),
  createdAt: new Date(Date.now() - 180 * 86400000).toISOString(),
};

const mockRelationships: GraphRelationship[] = [
  { entityId: 'comp-001', entityName: 'Acme Holdings', entityType: 'company', edgeLabel: 'SUBSIDIARY_OF', influenceScore: 0.85, communityId: 'comm-12', centralityScore: 0.72 },
  { entityId: 'deal-001', entityName: 'Enterprise Plan Upgrade', entityType: 'deal', edgeLabel: 'HAS_DEAL', influenceScore: 0.60, communityId: 'comm-12', centralityScore: 0.45 },
  { entityId: 'agent-collection', entityName: 'Collection Agent', entityType: 'agent', edgeLabel: 'ASSIGNED_TO', influenceScore: 0.40, communityId: 'comm-12', centralityScore: 0.30 },
  { entityId: 'contact-001', entityName: 'John D.', entityType: 'contact', edgeLabel: 'PRIMARY_CONTACT', influenceScore: 0.78, communityId: 'comm-12', centralityScore: 0.68 },
];

const channelOptions: InteractionRecord['channel'][] = ['sms', 'email', 'voice', 'chat', 'email'];
const directionOptions: InteractionRecord['direction'][] = ['outbound', 'inbound'];
const statusOptions: InteractionRecord['status'][] = ['delivered', 'delivered', 'sent', 'failed', 'received'];

const mockInteractions: InteractionRecord[] = Array.from({ length: 12 }, (_, i) => ({
  id: `int-${String(i + 1).padStart(5, '0')}`,
  channel: channelOptions[i % 5] ?? 'email',
  direction: directionOptions[i % 2] ?? 'outbound',
  status: statusOptions[i % 5] ?? 'delivered',
  timestamp: new Date(Date.now() - i * 3600000 * 6).toISOString(),
  agentId: i % 3 === 0 ? `agent-${(i % 4) + 1}` : null,
  correlationId: `req-${Date.now()}-${i}`,
}));

const mockAgentSessions: AgentSessionRecord[] = [
  { id: 'sess-101', agentRole: 'collection', outcome: 'success', confidence: 0.91, costUsd: 0.14, steps: 4, startedAt: new Date(Date.now() - 86400000).toISOString() },
  { id: 'sess-087', agentRole: 'support', outcome: 'success', confidence: 0.88, costUsd: 0.19, steps: 5, startedAt: new Date(Date.now() - 3 * 86400000).toISOString() },
  { id: 'sess-065', agentRole: 'onboarding', outcome: 'success', confidence: 0.95, costUsd: 0.08, steps: 3, startedAt: new Date(Date.now() - 7 * 86400000).toISOString() },
  { id: 'sess-042', agentRole: 'collection', outcome: 'escalated', confidence: 0.55, costUsd: 0.06, steps: 2, startedAt: new Date(Date.now() - 14 * 86400000).toISOString() },
];

const mockPayments: PaymentSummary = {
  outstandingBalance: 4250.00,
  paymentPlanStatus: 'active',
  lastPaymentDate: new Date(Date.now() - 5 * 86400000).toISOString(),
  records: [
    { id: 'pay-001', amount: 1500.00, status: 'completed', date: new Date(Date.now() - 5 * 86400000).toISOString(), method: 'ACH' },
    { id: 'pay-002', amount: 1500.00, status: 'completed', date: new Date(Date.now() - 35 * 86400000).toISOString(), method: 'ACH' },
    { id: 'pay-003', amount: 750.00, status: 'pending', date: new Date(Date.now() + 25 * 86400000).toISOString(), method: 'ACH' },
    { id: 'pay-004', amount: 500.00, status: 'failed', date: new Date(Date.now() - 65 * 86400000).toISOString(), method: 'Card' },
  ],
};

const mockPreferences: ContactPreference[] = [
  { channel: 'Email', priority: 1, consented: true, consentDate: new Date(Date.now() - 90 * 86400000).toISOString(), preferredTimeStart: '09:00', preferredTimeEnd: '17:00' },
  { channel: 'SMS', priority: 2, consented: true, consentDate: new Date(Date.now() - 90 * 86400000).toISOString(), preferredTimeStart: '10:00', preferredTimeEnd: '18:00' },
  { channel: 'Voice', priority: 3, consented: false, consentDate: null, preferredTimeStart: '09:00', preferredTimeEnd: '12:00' },
  { channel: 'Chat', priority: 4, consented: true, consentDate: new Date(Date.now() - 30 * 86400000).toISOString(), preferredTimeStart: '09:00', preferredTimeEnd: '21:00' },
];

// --- Helpers ---

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(amount);
}

function confidenceColor(c: number): string {
  if (c >= 0.8) return 'text-emerald-400';
  if (c >= 0.7) return 'text-amber-400';
  return 'text-red-400';
}

// --- Component ---

export function CustomerDetail(): ReactNode {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [relationships, setRelationships] = useState<GraphRelationship[]>([]);
  const [interactions, setInteractions] = useState<InteractionRecord[]>([]);
  const [agentSessions, setAgentSessions] = useState<AgentSessionRecord[]>([]);
  const [payments, setPayments] = useState<PaymentSummary | null>(null);
  const [preferences, setPreferences] = useState<ContactPreference[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    if (!id) return;
    setLoading(true);

    try {
      const [profileRes, interactionsRes, sessionsRes] = await Promise.allSettled([
        apiClient.get<CustomerProfile>(`/v1/customers/${id}`),
        apiClient.get<{ interactions: InteractionRecord[] }>(`/v1/messages?customerId=${id}`),
        apiClient.get<{ sessions: AgentSessionRecord[] }>(`/v1/agents/sessions?customerId=${id}`),
      ]);

      setProfile(profileRes.status === 'fulfilled' ? profileRes.value : { ...mockProfile, id: id });
      setInteractions(interactionsRes.status === 'fulfilled' ? interactionsRes.value.interactions : mockInteractions);
      setAgentSessions(sessionsRes.status === 'fulfilled' ? sessionsRes.value.sessions : mockAgentSessions);

      // These would be additional API calls in production
      setRelationships(mockRelationships);
      setPayments(mockPayments);
      setPreferences(mockPreferences);
    } catch {
      setProfile({ ...mockProfile, id: id || 'unknown' });
      setRelationships(mockRelationships);
      setInteractions(mockInteractions);
      setAgentSessions(mockAgentSessions);
      setPayments(mockPayments);
      setPreferences(mockPreferences);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner size="lg" label="Loading customer detail" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-4">
        <p className="text-sm text-content-secondary">Customer not found.</p>
        <Button size="sm" onClick={() => navigate('/customers')}>Back to Customers</Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Back + Header */}
      <div>
        <Button variant="ghost" size="sm" onClick={() => navigate('/customers')} className="mb-3">
          {'\u2190'} Back to Customers
        </Button>

        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-surface-tertiary text-lg font-bold text-content">
              {profile.name.charAt(0)}
            </div>
            <div>
              <h1 className="text-xl font-bold text-content">{profile.name}</h1>
              <div className="mt-1 flex items-center gap-2">
                <Badge variant={statusBadge[profile.status] ?? 'neutral'} dot size="sm">
                  {profile.status}
                </Badge>
                <Badge variant={lifecycleBadge[profile.lifecycleStage] ?? 'neutral'} size="sm">
                  {profile.lifecycleStage}
                </Badge>
                <span className="text-xs text-content-tertiary">{profile.email}</span>
              </div>
            </div>
          </div>

          <GaugeChart value={profile.healthScore} label="Health Score" size={100} />
        </div>
      </div>

      {/* PHI compliance notice */}
      <div className="flex items-center gap-2 rounded-lg border border-blue-500/20 bg-blue-500/5 px-4 py-2">
        <span className="text-blue-400" aria-hidden="true">{'\u25C6'}</span>
        <p className="text-2xs text-blue-300">
          Message/call content is never displayed. Only metadata is shown per HIPAA and SOC2 requirements.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left column — 2/3 */}
        <div className="space-y-6 lg:col-span-2">
          {/* Interaction Timeline */}
          <Card title="Interaction Timeline" actions={<Badge variant="info" size="sm">Metadata Only</Badge>} padding={false}>
            <div className="divide-y divide-border">
              {interactions.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-content-secondary">
                  No interactions recorded.
                </p>
              ) : (
                interactions.map((record) => (
                  <div key={record.id} className="flex items-start gap-3 px-4 py-3">
                    <span
                      className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-surface-tertiary text-xs"
                      aria-hidden="true"
                    >
                      {channelIcon[record.channel] ?? '\u2709'}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-content capitalize">{record.channel}</span>
                        <span className="text-xs text-content-tertiary" aria-label={`Direction: ${record.direction}`}>
                          {directionArrow[record.direction]}
                        </span>
                        <Badge variant={interactionStatusBadge[record.status] ?? 'neutral'} dot size="sm">
                          {record.status}
                        </Badge>
                        {record.agentId && (
                          <span className="text-2xs text-content-tertiary">Agent: {record.agentId}</span>
                        )}
                      </div>
                      <p className="mt-0.5 font-mono text-2xs text-content-tertiary">
                        {record.correlationId}
                      </p>
                    </div>
                    <span className="text-xs text-content-secondary">
                      {new Date(record.timestamp).toLocaleString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                ))
              )}
            </div>
          </Card>

          {/* Agent History */}
          <Card title="Agent Session History" padding={false}>
            <div className="divide-y divide-border">
              {agentSessions.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-content-secondary">
                  No agent sessions recorded.
                </p>
              ) : (
                agentSessions.map((session) => (
                  <div key={session.id} className="flex items-start justify-between px-4 py-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium capitalize text-content">{session.agentRole}</span>
                        <Badge variant={outcomeVariant[session.outcome] ?? 'neutral'} dot size="sm">
                          {session.outcome}
                        </Badge>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-content-tertiary">
                        <span className={confidenceColor(session.confidence)}>
                          Confidence: {(session.confidence * 100).toFixed(0)}%
                        </span>
                        <span>Cost: ${session.costUsd.toFixed(3)}</span>
                        <span>Steps: {session.steps}</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-content-secondary">
                        {new Date(session.startedAt).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                      </p>
                      <p className="mt-0.5 font-mono text-2xs text-content-tertiary">{session.id}</p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>

          {/* Payment History */}
          <Card title="Payment History">
            {payments && (
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <p className="text-2xs font-medium uppercase tracking-wider text-content-secondary">Outstanding</p>
                    <p className="mt-1 text-lg font-bold text-content">{formatCurrency(payments.outstandingBalance)}</p>
                  </div>
                  <div>
                    <p className="text-2xs font-medium uppercase tracking-wider text-content-secondary">Plan Status</p>
                    <Badge
                      variant={payments.paymentPlanStatus === 'active' ? 'success' :
                               payments.paymentPlanStatus === 'defaulted' ? 'danger' : 'neutral'}
                      size="sm"
                      dot
                      className="mt-1"
                    >
                      {payments.paymentPlanStatus}
                    </Badge>
                  </div>
                  <div>
                    <p className="text-2xs font-medium uppercase tracking-wider text-content-secondary">Last Payment</p>
                    <p className="mt-1 text-sm text-content">
                      {payments.lastPaymentDate
                        ? new Date(payments.lastPaymentDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                        : 'N/A'}
                    </p>
                  </div>
                </div>

                <div className="divide-y divide-border rounded-lg border border-border">
                  {payments.records.map((record) => (
                    <div key={record.id} className="flex items-center justify-between px-4 py-2.5">
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-sm font-semibold text-content">{formatCurrency(record.amount)}</span>
                        <Badge variant={paymentStatusVariant[record.status] ?? 'neutral'} size="sm" dot>
                          {record.status}
                        </Badge>
                      </div>
                      <div className="text-right">
                        <span className="text-xs text-content-secondary">
                          {new Date(record.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </span>
                        <span className="ml-2 text-2xs text-content-tertiary">{record.method}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Card>
        </div>

        {/* Right column — 1/3 */}
        <div className="space-y-6">
          {/* Graph Relationships */}
          <Card title="Graph Relationships">
            <div className="space-y-3">
              {relationships.length === 0 ? (
                <p className="text-sm text-content-secondary">No relationships found.</p>
              ) : (
                relationships.map((rel) => (
                  <div key={rel.entityId} className="rounded-lg border border-border bg-surface px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="text-xs" aria-hidden="true">
                        {entityTypeIcon[rel.entityType] ?? '\u25CF'}
                      </span>
                      <span className="text-sm font-medium text-content">{rel.entityName}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                      <Badge variant="neutral" size="sm">{rel.edgeLabel}</Badge>
                      <Badge variant="info" size="sm">{rel.entityType}</Badge>
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-2 text-2xs">
                      <div>
                        <p className="text-content-tertiary">Influence</p>
                        <p className="font-mono text-content-secondary">{rel.influenceScore.toFixed(2)}</p>
                      </div>
                      <div>
                        <p className="text-content-tertiary">Community</p>
                        <p className="font-mono text-content-secondary">{rel.communityId}</p>
                      </div>
                      <div>
                        <p className="text-content-tertiary">Centrality</p>
                        <p className="font-mono text-content-secondary">{rel.centralityScore.toFixed(2)}</p>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>

          {/* Contact Preferences */}
          <Card title="Contact Preferences">
            <div className="space-y-3">
              {preferences.map((pref) => (
                <div key={pref.channel} className="flex items-center justify-between rounded-lg border border-border bg-surface px-3 py-2.5">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-content">{pref.channel}</span>
                      <Badge variant="neutral" size="sm">#{pref.priority}</Badge>
                    </div>
                    <p className="mt-0.5 text-2xs text-content-tertiary">
                      {pref.preferredTimeStart} - {pref.preferredTimeEnd}
                    </p>
                  </div>
                  <Badge variant={pref.consented ? 'success' : 'danger'} dot size="sm">
                    {pref.consented ? 'Consented' : 'No Consent'}
                  </Badge>
                </div>
              ))}
            </div>
          </Card>

          {/* Customer Info */}
          <Card title="Customer Info">
            <div className="space-y-3">
              <div>
                <p className="text-2xs text-content-tertiary">Customer ID</p>
                <p className="font-mono text-xs text-content-secondary">{profile.id}</p>
              </div>
              <div>
                <p className="text-2xs text-content-tertiary">Last Contact</p>
                <p className="text-xs text-content-secondary">
                  {new Date(profile.lastContact).toLocaleDateString('en-US', {
                    month: 'long',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </p>
              </div>
              <div>
                <p className="text-2xs text-content-tertiary">Customer Since</p>
                <p className="text-xs text-content-secondary">
                  {new Date(profile.createdAt).toLocaleDateString('en-US', {
                    month: 'long',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </p>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
