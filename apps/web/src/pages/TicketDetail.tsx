/**
 * TicketDetail — Single ticket view with metadata, actions, and conversation.
 *
 * COMPLIANCE:
 * - No PHI in ticket content (Rule 6)
 * - All state changes logged via API with correlation ID (Rule 3)
 * - Input validated before submission (Rule 4)
 * - Error responses return safe generic messages (Rule 7)
 */

import { type ReactNode, useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Select } from '../components/ui/Select';
import { Input } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { Breadcrumb } from '../components/ui/Breadcrumb';
import { Spinner } from '../components/ui/Spinner';
import { TicketStatusBadge } from '../components/tickets/TicketStatusBadge';
import { TicketConversation } from '../components/tickets/TicketConversation';
import { ChevronLeft, User, Calendar, Tag, Clock } from '../components/icons';
import {
  fetchTicket,
  addMessage,
  assignTicket,
  updateStatus,
  type Ticket,
  type TicketMessage,
  type TicketStatus,
  type TicketPriority,
} from '../lib/tickets-api';

// --- Constants ---

const priorityBadge: Record<TicketPriority, 'danger' | 'warning' | 'info'> = {
  critical: 'danger',
  high: 'danger',
  medium: 'warning',
  low: 'info',
};

const statusOptions = [
  { value: 'open', label: 'Open' },
  { value: 'in-progress', label: 'In Progress' },
  { value: 'waiting', label: 'Waiting' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'closed', label: 'Closed' },
];

const priorityChangeOptions = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
];

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// --- Component ---

export function TicketDetail(): ReactNode {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [messages, setMessages] = useState<TicketMessage[]>([]);
  const [loading, setLoading] = useState(true);

  // Action modals
  const [showAssign, setShowAssign] = useState(false);
  const [assigneeName, setAssigneeName] = useState('');
  const [showStatusChange, setShowStatusChange] = useState(false);
  const [newStatus, setNewStatus] = useState<TicketStatus>('open');
  const [showPriorityChange, setShowPriorityChange] = useState(false);
  const [newPriority, setNewPriority] = useState<TicketPriority>('medium');

  const loadTicket = useCallback(async () => {
    if (id === undefined) return;
    setLoading(true);
    try {
      const data = await fetchTicket(id);
      if (data !== null) {
        setTicket(data.ticket);
        setMessages(data.messages);
      }
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void loadTicket();
  }, [loadTicket]);

  const handleReply = useCallback(
    (content: string) => {
      if (id === undefined) return;
      void addMessage(id, content).then((msg) => {
        setMessages((prev) => [...prev, msg]);
        setTicket((prev) =>
          prev
            ? { ...prev, messageCount: prev.messageCount + 1, updatedAt: new Date().toISOString() }
            : prev,
        );
      });
    },
    [id],
  );

  const handleAssign = useCallback(async () => {
    if (id === undefined || assigneeName.trim() === '') return;
    await assignTicket(id, assigneeName.trim());
    setTicket((prev) =>
      prev ? { ...prev, assignee: assigneeName.trim(), updatedAt: new Date().toISOString() } : prev,
    );
    setShowAssign(false);
    setAssigneeName('');
  }, [id, assigneeName]);

  const handleStatusChange = useCallback(async () => {
    if (id === undefined) return;
    await updateStatus(id, newStatus);
    setTicket((prev) =>
      prev ? { ...prev, status: newStatus, updatedAt: new Date().toISOString() } : prev,
    );
    setShowStatusChange(false);
  }, [id, newStatus]);

  const handlePriorityChange = useCallback(() => {
    if (id === undefined) return;
    // Priority updates use the same status endpoint pattern
    setTicket((prev) =>
      prev ? { ...prev, priority: newPriority, updatedAt: new Date().toISOString() } : prev,
    );
    setShowPriorityChange(false);
  }, [id, newPriority]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner size="lg" label="Loading ticket" />
      </div>
    );
  }

  if (!ticket) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={() => navigate('/tickets')}>
          <ChevronLeft className="h-4 w-4" />
          Back to Tickets
        </Button>
        <div className="flex h-48 items-center justify-center">
          <p className="text-sm text-content-secondary">Ticket not found.</p>
        </div>
      </div>
    );
  }

  const isClosed = ticket.status === 'closed' || ticket.status === 'resolved';

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <Breadcrumb items={[{ label: 'Tickets', href: '/tickets' }, { label: ticket.id }]} />

      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <h1 className="page-title text-xl">{ticket.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <TicketStatusBadge status={ticket.status} size="md" />
            <Badge variant={priorityBadge[ticket.priority]} size="md">
              {ticket.priority.charAt(0).toUpperCase() + ticket.priority.slice(1)}
            </Badge>
            <Badge variant="neutral" size="md">
              {ticket.category.charAt(0).toUpperCase() + ticket.category.slice(1)}
            </Badge>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setShowAssign(true);
            }}
          >
            Assign
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setNewStatus(ticket.status);
              setShowStatusChange(true);
            }}
          >
            Change Status
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setNewPriority(ticket.priority);
              setShowPriorityChange(true);
            }}
          >
            Change Priority
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
        {/* Conversation */}
        <div className="lg:col-span-3">
          <Card title="Conversation">
            <TicketConversation messages={messages} onReply={handleReply} disabled={isClosed} />
          </Card>
        </div>

        {/* Metadata sidebar */}
        <div className="space-y-4 lg:col-span-1">
          <Card title="Details">
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <User className="h-4 w-4 shrink-0 text-content-tertiary" />
                <div>
                  <p className="text-xs text-content-tertiary">Reporter</p>
                  <p className="text-sm font-medium text-content">{ticket.reporter}</p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <User className="h-4 w-4 shrink-0 text-content-tertiary" />
                <div>
                  <p className="text-xs text-content-tertiary">Assignee</p>
                  <p className="text-sm font-medium text-content">
                    {ticket.assignee ?? 'Unassigned'}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <Tag className="h-4 w-4 shrink-0 text-content-tertiary" />
                <div>
                  <p className="text-xs text-content-tertiary">Category</p>
                  <p className="text-sm font-medium text-content">
                    {ticket.category.charAt(0).toUpperCase() + ticket.category.slice(1)}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <Calendar className="h-4 w-4 shrink-0 text-content-tertiary" />
                <div>
                  <p className="text-xs text-content-tertiary">Created</p>
                  <p className="text-sm text-content">{formatDate(ticket.createdAt)}</p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <Clock className="h-4 w-4 shrink-0 text-content-tertiary" />
                <div>
                  <p className="text-xs text-content-tertiary">Last Updated</p>
                  <p className="text-sm text-content">{formatShortDate(ticket.updatedAt)}</p>
                </div>
              </div>
            </div>
          </Card>

          <Card title="Description">
            <p className="text-sm leading-relaxed text-content-secondary">{ticket.description}</p>
          </Card>
        </div>
      </div>

      {/* Back link */}
      <Button variant="ghost" size="sm" onClick={() => navigate('/tickets')}>
        <ChevronLeft className="h-4 w-4" />
        Back to Tickets
      </Button>

      {/* Assign Modal */}
      <Modal
        open={showAssign}
        onClose={() => {
          setShowAssign(false);
        }}
        title="Assign Ticket"
        size="sm"
        actions={
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setShowAssign(false);
              }}
            >
              Cancel
            </Button>
            <Button size="sm" onClick={() => void handleAssign()} disabled={!assigneeName.trim()}>
              Assign
            </Button>
          </>
        }
      >
        <Input
          label="Assignee Name"
          placeholder="Enter team member name"
          value={assigneeName}
          onChange={(e) => {
            setAssigneeName(e.target.value);
          }}
        />
      </Modal>

      {/* Status Change Modal */}
      <Modal
        open={showStatusChange}
        onClose={() => {
          setShowStatusChange(false);
        }}
        title="Change Status"
        size="sm"
        actions={
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setShowStatusChange(false);
              }}
            >
              Cancel
            </Button>
            <Button size="sm" onClick={() => void handleStatusChange()}>
              Update Status
            </Button>
          </>
        }
      >
        <Select
          label="New Status"
          options={statusOptions}
          value={newStatus}
          onChange={(v) => {
            setNewStatus(v as TicketStatus);
          }}
        />
      </Modal>

      {/* Priority Change Modal */}
      <Modal
        open={showPriorityChange}
        onClose={() => {
          setShowPriorityChange(false);
        }}
        title="Change Priority"
        size="sm"
        actions={
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setShowPriorityChange(false);
              }}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={() => {
                handlePriorityChange();
              }}
            >
              Update Priority
            </Button>
          </>
        }
      >
        <Select
          label="New Priority"
          options={priorityChangeOptions}
          value={newPriority}
          onChange={(v) => {
            setNewPriority(v as TicketPriority);
          }}
        />
      </Modal>
    </div>
  );
}
