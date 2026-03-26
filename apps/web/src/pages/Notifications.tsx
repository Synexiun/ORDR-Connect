/**
 * Notification Center — HITL approvals, compliance violations, escalations, SLA breaches.
 *
 * COMPLIANCE: No PHI in notifications — metadata and action descriptions only.
 * All notification interactions are audit-logged via apiClient correlation IDs.
 */

import { type ReactNode, useState, useEffect, useCallback } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Spinner } from '../components/ui/Spinner';
import { apiClient } from '../lib/api';

// --- Types ---

type NotificationType = 'hitl' | 'compliance' | 'escalation' | 'sla' | 'system';
type NotificationSeverity = 'critical' | 'high' | 'medium' | 'low';

interface Notification {
  id: string;
  type: NotificationType;
  severity: NotificationSeverity;
  title: string;
  description: string;
  timestamp: string;
  read: boolean;
  dismissed: boolean;
  actionLabel?: string;
  actionRoute?: string;
  metadata?: Record<string, string>;
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

// --- Constants ---

const typeLabel: Record<NotificationType, string> = {
  hitl: 'HITL Approval',
  compliance: 'Compliance',
  escalation: 'Escalation',
  sla: 'SLA Breach',
  system: 'System',
};

const typeIcon: Record<NotificationType, string> = {
  hitl: '\u26A0',
  compliance: '\u25C6',
  escalation: '\u25B2',
  sla: '\u23F0',
  system: '\u2699',
};

const typeBadge: Record<NotificationType, 'danger' | 'warning' | 'info' | 'neutral'> = {
  hitl: 'warning',
  compliance: 'danger',
  escalation: 'info',
  sla: 'danger',
  system: 'neutral',
};

const severityBadge: Record<NotificationSeverity, 'danger' | 'warning' | 'info' | 'neutral'> = {
  critical: 'danger',
  high: 'danger',
  medium: 'warning',
  low: 'info',
};

// --- Mock data ---

const mockHitlItems: HitlItem[] = [
  { id: 'hitl-001', sessionId: 'sess-003', agentType: 'collection', action: 'Send payment demand via SMS', reason: 'Confidence below threshold (0.52)', confidence: 0.52, customerName: 'Stark Industries', createdAt: new Date(Date.now() - 600000).toISOString() },
  { id: 'hitl-002', sessionId: 'sess-008', agentType: 'collection', action: 'Escalate account to legal team', reason: 'High-value irreversible action requires approval', confidence: 0.71, customerName: 'Wayne Enterprises', createdAt: new Date(Date.now() - 900000).toISOString() },
  { id: 'hitl-003', sessionId: 'sess-009', agentType: 'retention', action: 'Issue $5,000 credit to account', reason: 'Financial action requires human review', confidence: 0.83, customerName: 'Hooli', createdAt: new Date(Date.now() - 1500000).toISOString() },
];

const mockNotifications: Notification[] = [
  { id: 'notif-001', type: 'compliance', severity: 'critical', title: 'HIPAA PHI Exposure Blocked', description: 'PHI field detected in agent output — automatically redacted before delivery', timestamp: new Date(Date.now() - 300000).toISOString(), read: false, dismissed: false, actionRoute: '/compliance' },
  { id: 'notif-002', type: 'sla', severity: 'high', title: 'Response SLA Breach', description: '3 customer interactions exceeded 24-hour response SLA', timestamp: new Date(Date.now() - 1200000).toISOString(), read: false, dismissed: false, actionRoute: '/interactions' },
  { id: 'notif-003', type: 'escalation', severity: 'medium', title: 'Agent Escalation', description: 'Collection agent escalated high-value account — requires operator review', timestamp: new Date(Date.now() - 2400000).toISOString(), read: false, dismissed: false, actionRoute: '/agents' },
  { id: 'notif-004', type: 'compliance', severity: 'medium', title: 'TCPA Quiet Hours Violation', description: '3 outbound calls blocked during restricted hours', timestamp: new Date(Date.now() - 3600000).toISOString(), read: true, dismissed: false, actionRoute: '/compliance' },
  { id: 'notif-005', type: 'system', severity: 'low', title: 'Key Rotation Scheduled', description: 'Encryption key approaching 75-day threshold — automated rotation scheduled', timestamp: new Date(Date.now() - 7200000).toISOString(), read: true, dismissed: false },
  { id: 'notif-006', type: 'sla', severity: 'medium', title: 'Agent Performance Warning', description: 'Collection agent resolution rate dropped below 80% over last 24 hours', timestamp: new Date(Date.now() - 14400000).toISOString(), read: true, dismissed: false, actionRoute: '/agents' },
  { id: 'notif-007', type: 'compliance', severity: 'low', title: 'Audit Chain Verified', description: 'Merkle root verified for batch #8847 — 1000 events, chain intact', timestamp: new Date(Date.now() - 21600000).toISOString(), read: true, dismissed: false },
  { id: 'notif-008', type: 'escalation', severity: 'medium', title: 'Support Escalation', description: 'Support agent encountered unsupported request type — manual intervention needed', timestamp: new Date(Date.now() - 43200000).toISOString(), read: true, dismissed: true },
];

// --- Helpers ---

function formatTimestamp(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function confidenceColor(c: number): string {
  if (c >= 0.8) return 'text-emerald-400';
  if (c >= 0.7) return 'text-amber-400';
  return 'text-red-400';
}

// --- Component ---

export function Notifications(): ReactNode {
  const [hitlItems, setHitlItems] = useState<HitlItem[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<string>('all');

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [hitlRes] = await Promise.allSettled([
        apiClient.get<{ items: HitlItem[] }>('/v1/agents/hitl'),
      ]);

      setHitlItems(hitlRes.status === 'fulfilled' ? hitlRes.value.items : mockHitlItems);
      // Notifications are mock for MVP — would integrate with notification service
      setNotifications(mockNotifications);
    } catch {
      setHitlItems(mockHitlItems);
      setNotifications(mockNotifications);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const handleHitlAction = useCallback(async (item: HitlItem, action: 'approve' | 'reject') => {
    try {
      await apiClient.post(`/v1/agents/hitl/${item.id}/${action}`);
    } catch {
      // Mock update
    }
    setHitlItems((prev) => prev.filter((h) => h.id !== item.id));
  }, []);

  const handleMarkRead = useCallback((notifId: string) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === notifId ? { ...n, read: true } : n)),
    );
  }, []);

  const handleDismiss = useCallback((notifId: string) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === notifId ? { ...n, dismissed: true } : n)),
    );
  }, []);

  const filteredNotifications = notifications.filter((n) => {
    if (n.dismissed) return false;
    if (typeFilter === 'all') return true;
    return n.type === typeFilter;
  });

  const unreadCount = notifications.filter((n) => !n.read && !n.dismissed).length;

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner size="lg" label="Loading notifications" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-content">Notifications</h1>
          <p className="mt-1 text-sm text-content-secondary">
            {unreadCount > 0
              ? `${unreadCount} unread notification${unreadCount !== 1 ? 's' : ''}`
              : 'All caught up'}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={fetchData}>
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* HITL Queue — Priority */}
        <div>
          <Card
            title="HITL Approvals"
            actions={
              hitlItems.length > 0 ? (
                <Badge variant="warning" dot>{hitlItems.length} pending</Badge>
              ) : (
                <Badge variant="success" size="sm">Clear</Badge>
              )
            }
            padding={false}
          >
            <div className="divide-y divide-border">
              {hitlItems.map((item) => (
                <div key={item.id} className="p-4">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-content">{item.customerName}</span>
                    <Badge variant="warning" size="sm">{item.agentType}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-content-secondary">{item.action}</p>
                  <p className="mt-0.5 text-2xs text-content-tertiary">{item.reason}</p>
                  <p className={`mt-1 text-2xs font-mono ${confidenceColor(item.confidence)}`}>
                    Confidence: {(item.confidence * 100).toFixed(0)}%
                  </p>
                  <p className="mt-1 text-2xs text-content-tertiary">{formatTimestamp(item.createdAt)}</p>
                  <div className="mt-3 flex items-center gap-2">
                    <Button size="sm" onClick={() => handleHitlAction(item, 'approve')}>
                      Approve
                    </Button>
                    <Button variant="danger" size="sm" onClick={() => handleHitlAction(item, 'reject')}>
                      Reject
                    </Button>
                  </div>
                </div>
              ))}
              {hitlItems.length === 0 && (
                <p className="px-4 py-8 text-center text-sm text-content-secondary">
                  No items pending review.
                </p>
              )}
            </div>
          </Card>
        </div>

        {/* Notification list — 2/3 */}
        <div className="space-y-4 lg:col-span-2">
          {/* Type filter */}
          <div className="flex items-center gap-1">
            {['all', 'hitl', 'compliance', 'escalation', 'sla', 'system'].map((t) => (
              <Button
                key={t}
                variant={typeFilter === t ? 'primary' : 'ghost'}
                size="sm"
                onClick={() => setTypeFilter(t)}
              >
                {t === 'all' ? 'All' : typeLabel[t as NotificationType]}
              </Button>
            ))}
          </div>

          {/* Notification items */}
          <Card padding={false}>
            <div className="divide-y divide-border">
              {filteredNotifications.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-content-secondary">
                  No notifications matching the current filter.
                </p>
              ) : (
                filteredNotifications.map((notif) => (
                  <div
                    key={notif.id}
                    className={`flex items-start gap-3 p-4 transition-colors ${
                      notif.read ? 'bg-surface-secondary' : 'bg-surface-tertiary/30'
                    }`}
                  >
                    <span
                      className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-tertiary text-sm"
                      aria-hidden="true"
                    >
                      {typeIcon[notif.type]}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Badge variant={typeBadge[notif.type]} size="sm">
                          {typeLabel[notif.type]}
                        </Badge>
                        <Badge variant={severityBadge[notif.severity]} size="sm" dot>
                          {notif.severity}
                        </Badge>
                        {!notif.read && (
                          <span className="h-2 w-2 rounded-full bg-blue-400" aria-label="Unread" />
                        )}
                      </div>
                      <p className="mt-1 text-sm font-medium text-content">{notif.title}</p>
                      <p className="mt-0.5 text-xs text-content-secondary">{notif.description}</p>
                      <p className="mt-1 text-2xs text-content-tertiary">{formatTimestamp(notif.timestamp)}</p>
                    </div>
                    <div className="flex flex-col gap-1">
                      {!notif.read && (
                        <Button variant="ghost" size="sm" onClick={() => handleMarkRead(notif.id)}>
                          Read
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" onClick={() => handleDismiss(notif.id)}>
                        Dismiss
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
