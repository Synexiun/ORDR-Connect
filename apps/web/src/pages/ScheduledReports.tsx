/**
 * ScheduledReports — Schedule management for automated report generation.
 *
 * Features:
 * - Table: Name, Type, Frequency, Recipients, Next Run, Last Run, Status, Actions
 * - Create Schedule modal
 * - Actions: Edit, Pause/Resume, Delete
 *
 * COMPLIANCE: No PHI rendered. Schedule recipients are email addresses only —
 * no PHI in email bodies (handled server-side with compliance rules engine).
 */

import { type ReactNode, useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Table } from '../components/ui/Table';
import { Modal } from '../components/ui/Modal';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { Spinner } from '../components/ui/Spinner';
import {
  Plus,
  ChevronLeft,
  PlayCircle,
  PauseCircle,
  Trash2,
  Pencil,
  RefreshCw,
} from '../components/icons';
import {
  fetchScheduledReports,
  createSchedule,
  deleteSchedule,
  mockReportTemplates,
  type ScheduledReport,
  type ReportType,
  type ScheduleFrequency,
  type CreateSchedulePayload,
} from '../lib/reports-api';

// --- Helpers ---

function formatDateTime(iso: string): string {
  if (!iso) return '--';
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// --- Type/frequency options ---

const typeOptions = mockReportTemplates.map((t) => ({ value: t.type, label: t.name }));

const frequencyOptions = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
];

// --- Component ---

export function ScheduledReports(): ReactNode {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [schedules, setSchedules] = useState<ScheduledReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  // Form state
  const [formName, setFormName] = useState('');
  const [formType, setFormType] = useState<ReportType>('operations');
  const [formFrequency, setFormFrequency] = useState<ScheduleFrequency>('weekly');
  const [formRecipients, setFormRecipients] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);

  const loadSchedules = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchScheduledReports();
      setSchedules(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSchedules();
  }, [loadSchedules]);

  // Open create modal if ?create=type is in URL
  useEffect(() => {
    const createType = searchParams.get('create');
    if (createType !== null && mockReportTemplates.some((t) => t.type === createType)) {
      setFormType(createType as ReportType);
      const template = mockReportTemplates.find((t) => t.type === createType);
      setFormName(template !== undefined ? `Scheduled ${template.name}` : '');
      setModalOpen(true);
    }
  }, [searchParams]);

  const resetForm = useCallback(() => {
    setFormName('');
    setFormType('operations');
    setFormFrequency('weekly');
    setFormRecipients('');
    setEditingId(null);
  }, []);

  const openCreateModal = useCallback(() => {
    resetForm();
    setModalOpen(true);
  }, [resetForm]);

  const openEditModal = useCallback((schedule: ScheduledReport) => {
    setEditingId(schedule.id);
    setFormName(schedule.name);
    setFormType(schedule.type);
    setFormFrequency(schedule.frequency);
    setFormRecipients(schedule.recipients.join(', '));
    setModalOpen(true);
  }, []);

  const handleSave = useCallback(async () => {
    if (!formName.trim() || !formRecipients.trim()) return;

    setSaving(true);
    const payload: CreateSchedulePayload = {
      name: formName.trim(),
      type: formType,
      frequency: formFrequency,
      recipients: formRecipients
        .split(',')
        .map((r) => r.trim())
        .filter(Boolean),
    };

    try {
      if (editingId !== null) {
        // Mock edit: update local state
        setSchedules((prev) =>
          prev.map((s) =>
            s.id === editingId
              ? {
                  ...s,
                  name: payload.name,
                  type: payload.type,
                  frequency: payload.frequency,
                  recipients: payload.recipients,
                }
              : s,
          ),
        );
      } else {
        const newSchedule = await createSchedule(payload);
        setSchedules((prev) => [...prev, newSchedule]);
      }
      setModalOpen(false);
      resetForm();
    } finally {
      setSaving(false);
    }
  }, [formName, formType, formFrequency, formRecipients, editingId, resetForm]);

  const handleDelete = useCallback(async (scheduleId: string) => {
    setDeleting(scheduleId);
    try {
      await deleteSchedule(scheduleId);
      setSchedules((prev) => prev.filter((s) => s.id !== scheduleId));
    } finally {
      setDeleting(null);
    }
  }, []);

  const handleTogglePause = useCallback((scheduleId: string) => {
    setSchedules((prev) =>
      prev.map((s) =>
        s.id === scheduleId
          ? { ...s, status: s.status === 'active' ? ('paused' as const) : ('active' as const) }
          : s,
      ),
    );
  }, []);

  const isFormValid = useMemo(
    () => formName.trim().length > 0 && formRecipients.trim().length > 0,
    [formName, formRecipients],
  );

  // Table columns
  const columns = [
    {
      key: 'name',
      header: 'Name',
      sortable: true,
      render: (row: ScheduledReport) => (
        <span className="text-sm font-medium text-content">{row.name}</span>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      sortable: true,
      render: (row: ScheduledReport) => (
        <Badge variant="info" size="sm">
          {row.type}
        </Badge>
      ),
    },
    {
      key: 'frequency',
      header: 'Frequency',
      render: (row: ScheduledReport) => (
        <span className="text-xs capitalize text-content-secondary">{row.frequency}</span>
      ),
    },
    {
      key: 'recipients',
      header: 'Recipients',
      render: (row: ScheduledReport) => (
        <span className="text-xs text-content-secondary">
          {row.recipients.length} recipient{row.recipients.length !== 1 ? 's' : ''}
        </span>
      ),
    },
    {
      key: 'nextRun',
      header: 'Next Run',
      sortable: true,
      render: (row: ScheduledReport) => (
        <span className="text-xs text-content-secondary">{formatDateTime(row.nextRun)}</span>
      ),
    },
    {
      key: 'lastRun',
      header: 'Last Run',
      render: (row: ScheduledReport) => (
        <span className="text-xs text-content-secondary">
          {row.lastRun ? formatDateTime(row.lastRun) : 'Never'}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row: ScheduledReport) => (
        <Badge variant={row.status === 'active' ? 'success' : 'neutral'} size="sm" dot>
          {row.status}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      render: (row: ScheduledReport) => (
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            icon={<Pencil className="h-3.5 w-3.5" />}
            onClick={(e) => {
              e.stopPropagation();
              openEditModal(row);
            }}
          >
            Edit
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon={
              row.status === 'active' ? (
                <PauseCircle className="h-3.5 w-3.5" />
              ) : (
                <PlayCircle className="h-3.5 w-3.5" />
              )
            }
            onClick={(e) => {
              e.stopPropagation();
              handleTogglePause(row.id);
            }}
          >
            {row.status === 'active' ? 'Pause' : 'Resume'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon={<Trash2 className="h-3.5 w-3.5 text-red-400" />}
            onClick={(e) => {
              e.stopPropagation();
              void handleDelete(row.id);
            }}
            loading={deleting === row.id}
          >
            Delete
          </Button>
        </div>
      ),
    },
  ];

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner size="lg" label="Loading scheduled reports" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            icon={<ChevronLeft className="h-3.5 w-3.5" />}
            onClick={() => navigate('/reports')}
          >
            Reports
          </Button>
          <div>
            <h1 className="text-xl font-bold text-content">Scheduled Reports</h1>
            <p className="mt-1 text-sm text-content-secondary">
              {schedules.length} schedule{schedules.length !== 1 ? 's' : ''} configured
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            icon={<RefreshCw className="h-3.5 w-3.5" />}
            onClick={loadSchedules}
          >
            Refresh
          </Button>
          <Button size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={openCreateModal}>
            Create Schedule
          </Button>
        </div>
      </div>

      {/* Schedules table */}
      <Card padding={false}>
        <Table
          columns={columns}
          data={schedules}
          keyExtractor={(s) => s.id}
          emptyMessage="No scheduled reports. Create one to automate report delivery."
        />
      </Card>

      {/* Create / Edit modal */}
      <Modal
        open={modalOpen}
        onClose={() => {
          setModalOpen(false);
          resetForm();
        }}
        title={editingId !== null ? 'Edit Schedule' : 'Create Schedule'}
        size="md"
        actions={
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setModalOpen(false);
                resetForm();
              }}
            >
              Cancel
            </Button>
            <Button size="sm" onClick={handleSave} loading={saving} disabled={!isFormValid}>
              {editingId !== null ? 'Update Schedule' : 'Create Schedule'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input
            label="Schedule Name"
            placeholder="e.g., Weekly Operations Summary"
            value={formName}
            onChange={(e) => {
              setFormName(e.target.value);
            }}
          />
          <Select
            label="Report Type"
            options={typeOptions}
            value={formType}
            onChange={(v) => {
              setFormType(v as ReportType);
            }}
          />
          <Select
            label="Frequency"
            options={frequencyOptions}
            value={formFrequency}
            onChange={(v) => {
              setFormFrequency(v as ScheduleFrequency);
            }}
          />
          <Input
            label="Recipients"
            placeholder="email1@example.com, email2@example.com"
            value={formRecipients}
            onChange={(e) => {
              setFormRecipients(e.target.value);
            }}
            helperText="Comma-separated email addresses. Reports are sent with PHI excluded per compliance policy."
          />
        </div>
      </Modal>
    </div>
  );
}
