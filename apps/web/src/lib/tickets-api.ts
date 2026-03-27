/**
 * Support Ticketing API — Types, mock data, and fetch functions.
 *
 * COMPLIANCE:
 * - No PHI/PII in ticket content rendered to logs (Rule 6)
 * - All API calls use apiClient with correlation ID (Rule 3)
 * - Ticket conversations encrypted in transit (Rule 1)
 * - Error responses return safe generic messages (Rule 7)
 */

import { apiClient } from './api';

// --- Types ---

export type TicketStatus = 'open' | 'in-progress' | 'waiting' | 'resolved' | 'closed';
export type TicketPriority = 'low' | 'medium' | 'high' | 'critical';
export type TicketCategory = 'bug' | 'feature' | 'question' | 'compliance' | 'billing';

export interface Ticket {
  id: string;
  title: string;
  status: TicketStatus;
  priority: TicketPriority;
  category: TicketCategory;
  assignee: string | null;
  reporter: string;
  createdAt: string;
  updatedAt: string;
  description: string;
  messageCount: number;
}

export interface TicketMessage {
  id: string;
  ticketId: string;
  author: string;
  authorRole: 'user' | 'admin' | 'system';
  content: string;
  createdAt: string;
  attachments: string[];
}

export interface TicketStats {
  open: number;
  inProgress: number;
  avgResponseTime: string;
  avgResolutionTime: string;
  slaCompliance: number;
}

export interface CreateTicketPayload {
  title: string;
  category: TicketCategory;
  priority: TicketPriority;
  description: string;
}

// --- Mock Data ---

const mockTickets: Ticket[] = [
  {
    id: 'TKT-001',
    title: 'Agent confidence scores dropping below threshold',
    status: 'open',
    priority: 'high',
    category: 'bug',
    assignee: null,
    reporter: 'Sarah Chen',
    createdAt: '2026-03-24T14:30:00Z',
    updatedAt: '2026-03-24T16:45:00Z',
    description:
      'The Collections Agent has been reporting confidence scores below 0.5 for the last 4 hours. Multiple interactions are being routed to human review unnecessarily. This started after the latest model update was deployed.',
    messageCount: 3,
  },
  {
    id: 'TKT-002',
    title: 'Request: Bulk customer import via CSV',
    status: 'in-progress',
    priority: 'medium',
    category: 'feature',
    assignee: 'Marcus Rivera',
    reporter: 'Alex Thompson',
    createdAt: '2026-03-23T09:15:00Z',
    updatedAt: '2026-03-24T11:00:00Z',
    description:
      'We need the ability to import customer records in bulk via CSV upload. Currently we can only add customers one at a time through the API. A CSV import with validation and preview would save significant onboarding time.',
    messageCount: 5,
  },
  {
    id: 'TKT-003',
    title: 'HIPAA audit log gap detected in staging',
    status: 'open',
    priority: 'critical',
    category: 'compliance',
    assignee: 'Priya Sharma',
    reporter: 'David Kim',
    createdAt: '2026-03-24T08:00:00Z',
    updatedAt: '2026-03-24T09:30:00Z',
    description:
      'During routine verification, a 12-minute gap was found in the audit log hash chain on the staging environment between events 48,201 and 48,215. Production appears unaffected but requires immediate investigation.',
    messageCount: 4,
  },
  {
    id: 'TKT-004',
    title: 'Dashboard loading slowly for large tenants',
    status: 'waiting',
    priority: 'medium',
    category: 'bug',
    assignee: 'Marcus Rivera',
    reporter: 'Jennifer Walsh',
    createdAt: '2026-03-22T16:00:00Z',
    updatedAt: '2026-03-23T14:20:00Z',
    description:
      'Tenants with more than 10,000 customers are experiencing 8-12 second load times on the Dashboard. The bottleneck appears to be the summary aggregation query. Smaller tenants load in under 2 seconds.',
    messageCount: 6,
  },
  {
    id: 'TKT-005',
    title: 'Question about webhook retry policy',
    status: 'resolved',
    priority: 'low',
    category: 'question',
    assignee: 'Emily Nguyen',
    reporter: 'Robert Martinez',
    createdAt: '2026-03-21T11:30:00Z',
    updatedAt: '2026-03-22T09:00:00Z',
    description:
      'Can you clarify the webhook retry behavior? Our receiving endpoint sometimes returns 503 during deployments, and we want to make sure events are not lost during these brief windows.',
    messageCount: 2,
  },
  {
    id: 'TKT-006',
    title: 'Invoice discrepancy for March billing cycle',
    status: 'in-progress',
    priority: 'high',
    category: 'billing',
    assignee: 'Emily Nguyen',
    reporter: 'Laura Foster',
    createdAt: '2026-03-20T13:00:00Z',
    updatedAt: '2026-03-24T10:15:00Z',
    description:
      'Our March invoice shows 45,000 API calls but our internal tracking shows approximately 38,000. We need a detailed breakdown by endpoint and date to reconcile the difference.',
    messageCount: 7,
  },
  {
    id: 'TKT-007',
    title: 'Add Slack integration for agent alerts',
    status: 'closed',
    priority: 'low',
    category: 'feature',
    assignee: 'Marcus Rivera',
    reporter: 'Tom Bradley',
    createdAt: '2026-03-15T10:00:00Z',
    updatedAt: '2026-03-19T17:00:00Z',
    description:
      'We would like agent performance alerts to be sent to a dedicated Slack channel in addition to the in-app notifications. This would help our ops team respond faster to agent issues during business hours.',
    messageCount: 4,
  },
  {
    id: 'TKT-008',
    title: 'SOC 2 evidence collection for annual audit',
    status: 'waiting',
    priority: 'high',
    category: 'compliance',
    assignee: 'Priya Sharma',
    reporter: 'Sarah Chen',
    createdAt: '2026-03-18T09:00:00Z',
    updatedAt: '2026-03-23T15:00:00Z',
    description:
      'Our annual SOC 2 audit is scheduled for April 15. We need to collect evidence packages for CC6.1 through CC6.8 (Logical and Physical Access Controls). Please provide export capabilities for the relevant audit log segments.',
    messageCount: 5,
  },
];

const mockMessages: TicketMessage[] = [
  // TKT-001 messages
  {
    id: 'msg-001',
    ticketId: 'TKT-001',
    author: 'Sarah Chen',
    authorRole: 'user',
    content:
      'The Collections Agent has been reporting confidence scores below 0.5 for the last 4 hours. Multiple interactions are being routed to human review unnecessarily.',
    createdAt: '2026-03-24T14:30:00Z',
    attachments: [],
  },
  {
    id: 'msg-002',
    ticketId: 'TKT-001',
    author: 'System',
    authorRole: 'system',
    content: 'Ticket auto-classified as priority: high based on agent safety impact assessment.',
    createdAt: '2026-03-24T14:31:00Z',
    attachments: [],
  },
  {
    id: 'msg-003',
    ticketId: 'TKT-001',
    author: 'Priya Sharma',
    authorRole: 'admin',
    content:
      'Investigating. The model update from 14:00 UTC changed the embedding dimensions. Rolling back to the previous version while we validate the new configuration in sandbox.',
    createdAt: '2026-03-24T16:45:00Z',
    attachments: [],
  },
  // TKT-003 messages
  {
    id: 'msg-004',
    ticketId: 'TKT-003',
    author: 'David Kim',
    authorRole: 'user',
    content:
      'Hash chain verification flagged a gap between events 48,201 and 48,215 on staging. The Merkle root for the affected batch does not match. Production chain verified intact.',
    createdAt: '2026-03-24T08:00:00Z',
    attachments: [],
  },
  {
    id: 'msg-005',
    ticketId: 'TKT-003',
    author: 'System',
    authorRole: 'system',
    content:
      'P0 alert triggered: Audit chain integrity violation detected. Incident response runbook initiated.',
    createdAt: '2026-03-24T08:01:00Z',
    attachments: [],
  },
  {
    id: 'msg-006',
    ticketId: 'TKT-003',
    author: 'Priya Sharma',
    authorRole: 'admin',
    content:
      'Root cause identified: a staging database failover at 07:48 UTC caused a brief write interruption. The missing events were buffered in Kafka and will be replayed. Production uses a separate cluster and was not affected.',
    createdAt: '2026-03-24T09:30:00Z',
    attachments: [],
  },
  // TKT-005 messages
  {
    id: 'msg-007',
    ticketId: 'TKT-005',
    author: 'Robert Martinez',
    authorRole: 'user',
    content:
      'Can you clarify the webhook retry behavior? Our endpoint returns 503 during deployments and we want to ensure no events are lost.',
    createdAt: '2026-03-21T11:30:00Z',
    attachments: [],
  },
  {
    id: 'msg-008',
    ticketId: 'TKT-005',
    author: 'Emily Nguyen',
    authorRole: 'admin',
    content:
      'Webhooks use exponential backoff with 5 retry attempts over 24 hours. Specifically: 1min, 5min, 30min, 2hr, 12hr. If all retries fail, the event is stored in a dead-letter queue and you can replay it from the Developer Console. A 503 during brief deployments will be handled gracefully.',
    createdAt: '2026-03-22T09:00:00Z',
    attachments: [],
  },
  // TKT-006 messages
  {
    id: 'msg-009',
    ticketId: 'TKT-006',
    author: 'Laura Foster',
    authorRole: 'user',
    content:
      'Our March invoice shows 45,000 API calls but our internal tracking shows approximately 38,000. We need a detailed breakdown to reconcile.',
    createdAt: '2026-03-20T13:00:00Z',
    attachments: [],
  },
  {
    id: 'msg-010',
    ticketId: 'TKT-006',
    author: 'Emily Nguyen',
    authorRole: 'admin',
    content:
      'I have generated a per-endpoint daily breakdown for your tenant. The discrepancy appears to be from health check calls that your monitoring system is making to /v1/health every 30 seconds. These are counted as API calls. I will work with engineering to exclude health checks from billing.',
    createdAt: '2026-03-24T10:15:00Z',
    attachments: [],
  },
];

const mockStats: TicketStats = {
  open: 3,
  inProgress: 2,
  avgResponseTime: '1.4h',
  avgResolutionTime: '18.2h',
  slaCompliance: 94.5,
};

// --- Fetch Functions ---

export async function fetchTickets(): Promise<Ticket[]> {
  try {
    const res = await apiClient.get<{ tickets: Ticket[] }>('/v1/tickets');
    return res.tickets;
  } catch {
    return mockTickets;
  }
}

export async function fetchTicket(
  id: string,
): Promise<{ ticket: Ticket; messages: TicketMessage[] } | null> {
  try {
    return await apiClient.get<{ ticket: Ticket; messages: TicketMessage[] }>(`/v1/tickets/${id}`);
  } catch {
    const ticket = mockTickets.find((t) => t.id === id);
    if (!ticket) return null;
    const messages = mockMessages.filter((m) => m.ticketId === id);
    return { ticket, messages };
  }
}

export async function createTicket(payload: CreateTicketPayload): Promise<Ticket> {
  try {
    return await apiClient.post<Ticket>('/v1/tickets', payload);
  } catch {
    const newTicket: Ticket = {
      id: `TKT-${String(mockTickets.length + 1).padStart(3, '0')}`,
      title: payload.title,
      status: 'open',
      priority: payload.priority,
      category: payload.category,
      assignee: null,
      reporter: 'Current User',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      description: payload.description,
      messageCount: 1,
    };
    mockTickets.unshift(newTicket);
    return newTicket;
  }
}

export async function addMessage(ticketId: string, content: string): Promise<TicketMessage> {
  try {
    return await apiClient.post<TicketMessage>(`/v1/tickets/${ticketId}/messages`, { content });
  } catch {
    const msg: TicketMessage = {
      id: `msg-${Date.now()}`,
      ticketId,
      author: 'Current User',
      authorRole: 'user',
      content,
      createdAt: new Date().toISOString(),
      attachments: [],
    };
    mockMessages.push(msg);
    const ticket = mockTickets.find((t) => t.id === ticketId);
    if (ticket) {
      ticket.messageCount += 1;
      ticket.updatedAt = new Date().toISOString();
    }
    return msg;
  }
}

export async function assignTicket(ticketId: string, assignee: string): Promise<void> {
  try {
    await apiClient.patch(`/v1/tickets/${ticketId}`, { assignee });
  } catch {
    const ticket = mockTickets.find((t) => t.id === ticketId);
    if (ticket) {
      ticket.assignee = assignee;
      ticket.updatedAt = new Date().toISOString();
    }
  }
}

export async function updateStatus(ticketId: string, status: TicketStatus): Promise<void> {
  try {
    await apiClient.patch(`/v1/tickets/${ticketId}`, { status });
  } catch {
    const ticket = mockTickets.find((t) => t.id === ticketId);
    if (ticket) {
      ticket.status = status;
      ticket.updatedAt = new Date().toISOString();
    }
  }
}

export async function fetchStats(): Promise<TicketStats> {
  try {
    return await apiClient.get<TicketStats>('/v1/tickets/stats');
  } catch {
    return mockStats;
  }
}

export { mockTickets, mockMessages, mockStats };
