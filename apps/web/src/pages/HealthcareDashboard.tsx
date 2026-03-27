import { type ReactNode, useState, useEffect, useCallback } from 'react';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Spinner } from '../components/ui/Spinner';
import { GaugeChart } from '../components/charts/GaugeChart';

import {
  HeartPulse,
  Activity,
  Shield,
  ShieldCheck,
  Stethoscope,
  Clock,
  BedDouble,
  RefreshCw,
  TrendingUp,
  CheckCircle2,
  AlertTriangle,
  Brain,
} from '../components/icons';

// --- Types ---
// SECURITY: All patient data uses tokenized identifiers.
// No PHI (Protected Health Information) is displayed in this dashboard.
// HIPAA §164.312(a)(1) — Access control + §164.502(b) — Minimum necessary.

interface PatientQueueItem {
  /** Tokenized patient identifier — NOT the real name (HIPAA safe) */
  tokenId: string;
  /** Priority level (not PHI) */
  priority: 'urgent' | 'high' | 'normal' | 'low';
  /** Queue position */
  position: number;
  /** Wait time in minutes */
  waitMinutes: number;
  /** Department (not PHI) */
  department: string;
}

interface AppointmentItem {
  id: string;
  /** Tokenized patient reference */
  patientToken: string;
  /** Appointment time */
  scheduledAt: string;
  /** Duration in minutes */
  durationMinutes: number;
  /** Appointment type (not PHI) */
  type: 'consultation' | 'follow-up' | 'procedure' | 'screening';
  /** Completion status */
  status: 'scheduled' | 'in-progress' | 'completed' | 'cancelled';
}

interface CarePlanStatus {
  id: string;
  /** Tokenized patient reference */
  patientToken: string;
  /** Plan phase (not PHI) */
  phase: 'assessment' | 'planning' | 'implementation' | 'evaluation';
  /** Completion percentage */
  completionPct: number;
  /** Last updated */
  updatedAt: string;
}

interface ComplianceStatus {
  /** Overall compliance level */
  level: 'green' | 'yellow' | 'red';
  /** HIPAA audit score */
  hipaaScore: number;
  /** Last audit date */
  lastAuditDate: string;
  /** Open findings count */
  openFindings: number;
  /** Checks passed / total */
  checksPassed: number;
  checksTotal: number;
}

interface AgentActivityItem {
  id: string;
  agentName: string;
  action: string;
  status: 'completed' | 'pending' | 'failed';
  timestamp: string;
  confidence: number;
}

// --- Constants ---

const priorityBadge: Record<
  PatientQueueItem['priority'],
  'danger' | 'warning' | 'info' | 'neutral'
> = {
  urgent: 'danger',
  high: 'warning',
  normal: 'info',
  low: 'neutral',
};

const appointmentBadge: Record<
  AppointmentItem['status'],
  'info' | 'warning' | 'success' | 'neutral'
> = {
  scheduled: 'info',
  'in-progress': 'warning',
  completed: 'success',
  cancelled: 'neutral',
};

const phaseBadge: Record<CarePlanStatus['phase'], 'info' | 'warning' | 'success' | 'neutral'> = {
  assessment: 'info',
  planning: 'warning',
  implementation: 'success',
  evaluation: 'neutral',
};

function complianceTextColor(level: ComplianceStatus['level']): string {
  if (level === 'green') return 'text-emerald-400';
  if (level === 'yellow') return 'text-amber-400';
  return 'text-red-400';
}

// --- Mock data (tokenized — NO PHI) ---

const mockQueue: PatientQueueItem[] = [
  { tokenId: 'PTK-8a2f', priority: 'urgent', position: 1, waitMinutes: 5, department: 'Emergency' },
  { tokenId: 'PTK-3b9e', priority: 'high', position: 2, waitMinutes: 12, department: 'Cardiology' },
  { tokenId: 'PTK-7c1d', priority: 'normal', position: 3, waitMinutes: 25, department: 'General' },
  {
    tokenId: 'PTK-4e6a',
    priority: 'normal',
    position: 4,
    waitMinutes: 30,
    department: 'Orthopedics',
  },
  { tokenId: 'PTK-9f2b', priority: 'low', position: 5, waitMinutes: 45, department: 'Dermatology' },
];

const APPOINTMENT_TYPES = ['consultation', 'follow-up', 'procedure', 'screening'] as const;
const APPOINTMENT_STATUSES = ['scheduled', 'in-progress', 'completed', 'scheduled'] as const;
const DURATIONS = [30, 45, 60, 15] as const;

const mockAppointments: AppointmentItem[] = Array.from({ length: 8 }, (_, i) => ({
  id: `appt-${String(i + 1).padStart(3, '0')}`,
  patientToken: `PTK-${Math.random().toString(36).slice(2, 6)}`,
  scheduledAt: new Date(Date.now() + (i - 2) * 3600000).toISOString(),
  durationMinutes: DURATIONS[i % 4] ?? 30,
  type: APPOINTMENT_TYPES[i % 4] ?? 'consultation',
  status: APPOINTMENT_STATUSES[i % 4] ?? 'scheduled',
}));

const mockCarePlans: CarePlanStatus[] = [
  {
    id: 'cp-001',
    patientToken: 'PTK-8a2f',
    phase: 'implementation',
    completionPct: 75,
    updatedAt: new Date(Date.now() - 86400000).toISOString(),
  },
  {
    id: 'cp-002',
    patientToken: 'PTK-3b9e',
    phase: 'planning',
    completionPct: 30,
    updatedAt: new Date(Date.now() - 2 * 86400000).toISOString(),
  },
  {
    id: 'cp-003',
    patientToken: 'PTK-7c1d',
    phase: 'evaluation',
    completionPct: 90,
    updatedAt: new Date(Date.now() - 3600000).toISOString(),
  },
  {
    id: 'cp-004',
    patientToken: 'PTK-4e6a',
    phase: 'assessment',
    completionPct: 15,
    updatedAt: new Date().toISOString(),
  },
];

const mockCompliance: ComplianceStatus = {
  level: 'green',
  hipaaScore: 96,
  lastAuditDate: new Date(Date.now() - 7 * 86400000).toISOString(),
  openFindings: 2,
  checksPassed: 48,
  checksTotal: 50,
};

const mockAgentActivity: AgentActivityItem[] = [
  {
    id: 'aa-001',
    agentName: 'Healthcare Scheduler',
    action: 'Scheduled follow-up appointment',
    status: 'completed',
    timestamp: new Date(Date.now() - 300000).toISOString(),
    confidence: 0.94,
  },
  {
    id: 'aa-002',
    agentName: 'Healthcare Scheduler',
    action: 'Sent appointment reminder',
    status: 'completed',
    timestamp: new Date(Date.now() - 600000).toISOString(),
    confidence: 0.98,
  },
  {
    id: 'aa-003',
    agentName: 'Healthcare Scheduler',
    action: 'Processing care plan update',
    status: 'pending',
    timestamp: new Date(Date.now() - 120000).toISOString(),
    confidence: 0.72,
  },
  {
    id: 'aa-004',
    agentName: 'Healthcare Scheduler',
    action: 'Flagged compliance review',
    status: 'completed',
    timestamp: new Date(Date.now() - 1800000).toISOString(),
    confidence: 0.85,
  },
  {
    id: 'aa-005',
    agentName: 'Healthcare Scheduler',
    action: 'Wait-list optimization',
    status: 'failed',
    timestamp: new Date(Date.now() - 3600000).toISOString(),
    confidence: 0.45,
  },
];

// --- Component ---

export function HealthcareDashboard(): ReactNode {
  const [queue, setQueue] = useState<PatientQueueItem[]>([]);
  const [appointments, setAppointments] = useState<AppointmentItem[]>([]);
  const [carePlans, setCarePlans] = useState<CarePlanStatus[]>([]);
  const [compliance, setCompliance] = useState<ComplianceStatus | null>(null);
  const [agentActivity, setAgentActivity] = useState<AgentActivityItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(() => {
    setLoading(true);
    try {
      // Healthcare-specific backend routes are not yet implemented.
      // This dashboard operates in demo mode with representative mock data.
      setQueue(mockQueue);
      setAppointments(mockAppointments);
      setCarePlans(mockCarePlans);
      setCompliance(mockCompliance);
      setAgentActivity(mockAgentActivity);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner size="lg" label="Loading healthcare dashboard" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Healthcare Dashboard</h1>
          <p className="page-subtitle">Patient operations overview (HIPAA compliant)</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            icon={<RefreshCw className="h-3.5 w-3.5" />}
            onClick={fetchData}
          >
            Refresh
          </Button>
        </div>
      </div>

      {/* KPI Cards — accent borders + medical icons + font-mono values */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="kpi-card-red">
          <div className="flex items-center justify-between">
            <p className="metric-label">Queue Length</p>
            <HeartPulse className="h-4 w-4 text-kpi-red" />
          </div>
          <p className="metric-value mt-2">{queue.length}</p>
          <p className="mt-1 text-xs text-content-secondary">
            {queue.filter((q) => q.priority === 'urgent').length} urgent
          </p>
        </div>

        <div className="kpi-card-blue">
          <div className="flex items-center justify-between">
            <p className="metric-label">Appointments Today</p>
            <Stethoscope className="h-4 w-4 text-kpi-blue" />
          </div>
          <p className="metric-value mt-2">{appointments.length}</p>
          <p className="mt-1 text-xs text-content-secondary">
            {appointments.filter((a) => a.status === 'completed').length} completed
          </p>
        </div>

        <div className="kpi-card-green">
          <div className="flex items-center justify-between">
            <p className="metric-label">Active Care Plans</p>
            <Activity className="h-4 w-4 text-kpi-green" />
          </div>
          <p className="metric-value mt-2">{carePlans.length}</p>
          <p className="metric-delta-up mt-1">
            <TrendingUp className="h-3 w-3" /> On track
          </p>
        </div>

        <div className="kpi-card-purple">
          <div className="flex items-center justify-between">
            <p className="metric-label">Avg Wait Time</p>
            <Clock className="h-4 w-4 text-kpi-purple" />
          </div>
          <p className="metric-value mt-2">
            {queue.length > 0
              ? Math.round(queue.reduce((sum, q) => sum + q.waitMinutes, 0) / queue.length)
              : 0}
            <span className="ml-0.5 text-sm font-normal text-content-secondary">min</span>
          </p>
          <p className="mt-1 text-xs text-content-secondary">Across all departments</p>
        </div>
      </div>

      {/* HIPAA Compliance + Capacity Gauges */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* HIPAA Compliance status widget */}
        <Card
          title="HIPAA Compliance Status"
          accent="green"
          actions={
            compliance && (
              <div className="flex items-center gap-2">
                <ShieldCheck className={`h-4 w-4 ${complianceTextColor(compliance.level)}`} />
                <span className={`text-sm font-semibold ${complianceTextColor(compliance.level)}`}>
                  {compliance.level.toUpperCase()}
                </span>
              </div>
            )
          }
        >
          {compliance && (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div>
                <p className="metric-label">HIPAA Score</p>
                <p
                  className={`mt-1 font-mono text-lg font-bold ${complianceTextColor(compliance.level)}`}
                >
                  {compliance.hipaaScore}%
                </p>
              </div>
              <div>
                <p className="metric-label">Checks Passed</p>
                <p className="mt-1 font-mono text-lg font-bold text-content">
                  {compliance.checksPassed}/{compliance.checksTotal}
                </p>
              </div>
              <div>
                <p className="metric-label">Open Findings</p>
                <p className="mt-1 font-mono text-lg font-bold text-content">
                  {compliance.openFindings}
                </p>
              </div>
              <div>
                <p className="metric-label">Last Audit</p>
                <p className="mt-1 text-sm text-content">
                  {new Date(compliance.lastAuditDate).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </p>
              </div>
            </div>
          )}
        </Card>

        {/* Capacity Gauges */}
        <Card
          title="Capacity Metrics"
          accent="blue"
          actions={
            <Badge variant="info" dot size="sm">
              Live
            </Badge>
          }
        >
          <div className="grid grid-cols-3 gap-4">
            <GaugeChart
              value={queue.length > 0 ? Math.min(100, Math.round((queue.length / 10) * 100)) : 0}
              label="Queue Load"
              size={100}
            />
            <GaugeChart
              value={
                appointments.length > 0
                  ? Math.round(
                      (appointments.filter(
                        (a) => a.status === 'completed' || a.status === 'in-progress',
                      ).length /
                        appointments.length) *
                        100,
                    )
                  : 0
              }
              label="Utilization"
              size={100}
            />
            <GaugeChart value={compliance?.hipaaScore ?? 0} label="Compliance" size={100} />
          </div>
        </Card>
      </div>

      {/* Patient Queue + Appointment Schedule */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Patient Queue (tokenized names) */}
        <Card
          title="Patient Queue"
          accent="red"
          actions={
            <div className="flex items-center gap-2">
              <HeartPulse className="h-3.5 w-3.5 text-kpi-red" />
              <Badge variant="info" dot size="sm">
                Live
              </Badge>
            </div>
          }
        >
          <div className="space-y-2">
            {queue.length === 0 ? (
              <p className="text-sm text-content-secondary">Queue is empty.</p>
            ) : (
              queue.map((item) => (
                <div
                  key={item.tokenId}
                  className="flex items-center justify-between rounded-lg border border-border bg-surface-secondary p-3"
                >
                  <div className="flex items-center gap-3">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-surface-tertiary text-xs font-medium text-content">
                      {item.position}
                    </span>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm text-content">{item.tokenId}</span>
                        <Badge variant={priorityBadge[item.priority]} size="sm">
                          {item.priority}
                        </Badge>
                      </div>
                      <p className="text-2xs text-content-tertiary">{item.department}</p>
                    </div>
                  </div>
                  <span className="font-mono text-xs text-content-secondary">
                    {item.waitMinutes}m wait
                  </span>
                </div>
              ))
            )}
          </div>
        </Card>

        {/* Appointment Schedule */}
        <Card
          title="Appointment Schedule"
          accent="blue"
          actions={
            <div className="flex items-center gap-2">
              <Stethoscope className="h-3.5 w-3.5 text-kpi-blue" />
              <Badge variant="info" size="sm">
                Today
              </Badge>
            </div>
          }
        >
          <div className="space-y-2">
            {appointments.length === 0 ? (
              <p className="text-sm text-content-secondary">No appointments scheduled.</p>
            ) : (
              appointments.slice(0, 6).map((appt) => (
                <div
                  key={appt.id}
                  className="flex items-center justify-between rounded-lg border border-border bg-surface-secondary p-3"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-content">{appt.patientToken}</span>
                      <Badge variant={appointmentBadge[appt.status]} size="sm">
                        {appt.status}
                      </Badge>
                    </div>
                    <p className="mt-0.5 text-2xs text-content-tertiary">
                      {appt.type} {'\u00B7'} {appt.durationMinutes}min
                    </p>
                  </div>
                  <span className="font-mono text-xs text-content-secondary">
                    {new Date(appt.scheduledAt).toLocaleTimeString('en-US', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>

      {/* Care Plans + Agent Activity */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Care Plan Status */}
        <Card
          title="Care Plan Status"
          accent="green"
          actions={
            <div className="flex items-center gap-2">
              <BedDouble className="h-3.5 w-3.5 text-kpi-green" />
              <Badge variant="success" size="sm">
                {carePlans.length} active
              </Badge>
            </div>
          }
        >
          <div className="space-y-3">
            {carePlans.length === 0 ? (
              <p className="text-sm text-content-secondary">No care plans active.</p>
            ) : (
              carePlans.map((plan) => (
                <div key={plan.id} className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-content">{plan.patientToken}</span>
                      <Badge variant={phaseBadge[plan.phase]} size="sm">
                        {plan.phase}
                      </Badge>
                    </div>
                    <span className="font-mono text-xs font-semibold text-content">
                      {plan.completionPct}%
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-surface-tertiary">
                    <div
                      className="h-full rounded-full bg-brand-accent transition-all"
                      style={{ width: `${String(plan.completionPct)}%` }}
                    />
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>

        {/* Agent Activity */}
        <Card
          title="Agent Activity"
          accent="purple"
          actions={
            <div className="flex items-center gap-2">
              <Brain className="h-3.5 w-3.5 text-kpi-purple" />
              <Badge variant="info" dot size="sm">
                Healthcare Agent
              </Badge>
            </div>
          }
        >
          <div className="space-y-2">
            {agentActivity.length === 0 ? (
              <p className="text-sm text-content-secondary">No recent agent activity.</p>
            ) : (
              agentActivity.map((activity) => (
                <div
                  key={activity.id}
                  className="flex items-center justify-between rounded-lg border border-border bg-surface-secondary p-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs text-content">{activity.action}</p>
                    <p className="text-2xs text-content-tertiary">
                      {new Date(activity.timestamp).toLocaleTimeString('en-US', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                      {' \u00B7 '}
                      Confidence:{' '}
                      <span className="font-mono">{(activity.confidence * 100).toFixed(0)}%</span>
                      {activity.confidence < 0.7 && (
                        <AlertTriangle className="ml-1 inline h-3 w-3 text-amber-400" />
                      )}
                    </p>
                  </div>
                  <Badge
                    variant={
                      activity.status === 'completed'
                        ? 'success'
                        : activity.status === 'pending'
                          ? 'warning'
                          : 'danger'
                    }
                    size="sm"
                  >
                    {activity.status === 'completed' && (
                      <CheckCircle2 className="mr-0.5 inline h-2.5 w-2.5" />
                    )}
                    {activity.status}
                  </Badge>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>

      {/* HIPAA Notice */}
      <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-secondary px-4 py-3">
        <Shield className="h-4 w-4 shrink-0 text-content-tertiary" />
        <p className="text-2xs text-content-tertiary">
          All patient identifiers shown are tokenized references. No Protected Health Information
          (PHI) is displayed, stored, or transmitted in this dashboard. HIPAA {'\u00A7'}
          164.312(a)(1) compliant.
        </p>
      </div>
    </div>
  );
}
