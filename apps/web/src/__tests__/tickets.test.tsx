/**
 * Tickets and TicketDetail Component Tests
 *
 * Validates:
 * - Tickets renders page heading and ticket count
 * - Tickets shows KPI cards (Open, In Progress, Avg Response, SLA)
 * - Tickets shows loading spinner initially
 * - Tickets renders ticket table with columns
 * - Tickets shows ticket data rows from mock data
 * - Tickets shows filter selects (status, priority, category)
 * - Tickets shows search input
 * - Tickets shows Create Ticket button
 * - Tickets shows status badges via TicketStatusBadge
 * - Tickets shows priority and category badges
 * - Tickets shows assignee and unassigned labels
 * - TicketDetail renders ticket title and metadata
 * - TicketDetail renders breadcrumb navigation
 * - TicketDetail renders conversation messages
 * - TicketDetail shows loading spinner initially
 * - TicketDetail shows ticket not found for invalid ID
 * - TicketDetail shows action buttons (Assign, Change Status, Change Priority)
 * - TicketDetail shows description sidebar
 * - TicketDetail shows reply form
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { BrowserRouter, MemoryRouter, Routes, Route } from 'react-router-dom';
import { Tickets } from '../pages/Tickets';
import { TicketDetail } from '../pages/TicketDetail';

// ─── Mock apiClient ──────────────────────────────────────────────

const mockGet = vi.fn();
const mockPost = vi.fn();
const mockPatch = vi.fn();

vi.mock('../lib/api', () => ({
  apiClient: {
    get: (...args: unknown[]) => mockGet(...args) as unknown,
    post: (...args: unknown[]) => mockPost(...args) as unknown,
    patch: (...args: unknown[]) => mockPatch(...args) as unknown,
  },
}));

// ─── Helpers ────────────────────────────────────────────────────

function renderTickets(): ReturnType<typeof render> {
  return render(createElement(BrowserRouter, null, createElement(Tickets)));
}

function renderTicketDetail(id: string): ReturnType<typeof render> {
  return render(
    createElement(
      MemoryRouter,
      { initialEntries: [`/tickets/${id}`] },
      createElement(
        Routes,
        null,
        createElement(Route, {
          path: '/tickets/:id',
          element: createElement(TicketDetail),
        }),
      ),
    ),
  );
}

// ─── Setup / Teardown ────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  // jsdom does not implement HTMLDialogElement.showModal/close
  HTMLDialogElement.prototype.showModal = vi.fn();
  HTMLDialogElement.prototype.close = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Tickets List Tests ─────────────────────────────────────────

describe('Tickets', () => {
  it('renders page heading', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderTickets();

    await waitFor(() => {
      expect(screen.getByText('Support Tickets')).toBeDefined();
    });
  });

  it('shows loading spinner initially', () => {
    mockGet.mockImplementation(
      () =>
        new Promise(() => {
          /* never resolves */
        }),
    );
    renderTickets();

    expect(screen.getByText('Loading tickets')).toBeDefined();
  });

  it('shows ticket count in subtitle', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderTickets();

    await waitFor(() => {
      expect(screen.getByText('8 tickets total')).toBeDefined();
    });
  });

  it('shows Create Ticket button', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderTickets();

    await waitFor(() => {
      expect(screen.getByText('Create Ticket')).toBeDefined();
    });
  });

  it('renders KPI card: Open Tickets', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderTickets();

    await waitFor(() => {
      expect(screen.getByText('Open Tickets')).toBeDefined();
      // "3" appears in KPI value and possibly in message counts
      expect(screen.getAllByText('3').length).toBeGreaterThan(0);
    });
  });

  it('renders KPI card: In Progress', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderTickets();

    await waitFor(() => {
      // "In Progress" appears in KPI label and status badges in the table
      expect(screen.getAllByText('In Progress').length).toBeGreaterThan(0);
      // "2" appears in KPI value and message counts
      expect(screen.getAllByText('2').length).toBeGreaterThan(0);
    });
  });

  it('renders KPI card: Avg Response Time', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderTickets();

    await waitFor(() => {
      expect(screen.getByText('Avg Response Time')).toBeDefined();
      expect(screen.getByText('1.4h')).toBeDefined();
    });
  });

  it('renders KPI card: SLA Compliance', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderTickets();

    await waitFor(() => {
      expect(screen.getByText('SLA Compliance')).toBeDefined();
      expect(screen.getByText('94.5%')).toBeDefined();
    });
  });

  it('renders ticket table column headers', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderTickets();

    await waitFor(() => {
      expect(screen.getByText('ID')).toBeDefined();
      expect(screen.getByText('Title')).toBeDefined();
      expect(screen.getByText('Status')).toBeDefined();
      expect(screen.getByText('Priority')).toBeDefined();
      expect(screen.getByText('Category')).toBeDefined();
      expect(screen.getByText('Assignee')).toBeDefined();
      expect(screen.getByText('Updated')).toBeDefined();
      expect(screen.getByText('Msgs')).toBeDefined();
    });
  });

  it('renders ticket rows from mock data', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderTickets();

    await waitFor(() => {
      expect(screen.getByText('TKT-001')).toBeDefined();
      expect(screen.getByText('Agent confidence scores dropping below threshold')).toBeDefined();
      expect(screen.getByText('TKT-002')).toBeDefined();
      expect(screen.getByText('Request: Bulk customer import via CSV')).toBeDefined();
      expect(screen.getByText('TKT-003')).toBeDefined();
      expect(screen.getByText('HIPAA audit log gap detected in staging')).toBeDefined();
    });
  });

  it('renders status badges', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderTickets();

    await waitFor(() => {
      expect(screen.getAllByText('Open').length).toBeGreaterThan(0);
      expect(screen.getAllByText('In Progress').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Waiting').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Resolved').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Closed').length).toBeGreaterThan(0);
    });
  });

  it('renders priority badges', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderTickets();

    await waitFor(() => {
      expect(screen.getAllByText('High').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Medium').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Low').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Critical').length).toBeGreaterThan(0);
    });
  });

  it('renders category badges', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderTickets();

    await waitFor(() => {
      expect(screen.getAllByText('Bug').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Feature').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Question').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Compliance').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Billing').length).toBeGreaterThan(0);
    });
  });

  it('shows assignee names and unassigned label', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderTickets();

    await waitFor(() => {
      // Marcus Rivera is assigned to multiple tickets
      expect(screen.getAllByText('Marcus Rivera').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Priya Sharma').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Emily Nguyen').length).toBeGreaterThan(0);
      expect(screen.getByText('Unassigned')).toBeDefined();
    });
  });

  it('shows search input with aria-label', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderTickets();

    await waitFor(() => {
      const input = screen.getByLabelText('Search tickets');
      expect(input).toBeDefined();
    });
  });

  it('opens create ticket modal', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderTickets();

    await waitFor(() => {
      expect(screen.getByText('Create Ticket')).toBeDefined();
    });

    act(() => {
      fireEvent.click(screen.getByText('Create Ticket'));
    });

    expect(screen.getByText('Create Support Ticket')).toBeDefined();
  });

  it('create ticket modal shows form fields', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderTickets();

    await waitFor(() => {
      expect(screen.getByText('Create Ticket')).toBeDefined();
    });

    act(() => {
      fireEvent.click(screen.getByText('Create Ticket'));
    });

    expect(screen.getByPlaceholderText('Brief summary of the issue')).toBeDefined();
    expect(screen.getByPlaceholderText('Describe the issue in detail...')).toBeDefined();
  });

  it('create ticket modal has Cancel button', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderTickets();

    await waitFor(() => {
      expect(screen.getByText('Create Ticket')).toBeDefined();
    });

    act(() => {
      fireEvent.click(screen.getByText('Create Ticket'));
    });

    expect(screen.getByText('Cancel')).toBeDefined();
  });

  it('shows all 8 ticket rows', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderTickets();

    await waitFor(() => {
      expect(screen.getByText('TKT-001')).toBeDefined();
      expect(screen.getByText('TKT-002')).toBeDefined();
      expect(screen.getByText('TKT-003')).toBeDefined();
      expect(screen.getByText('TKT-004')).toBeDefined();
      expect(screen.getByText('TKT-005')).toBeDefined();
      expect(screen.getByText('TKT-006')).toBeDefined();
      expect(screen.getByText('TKT-007')).toBeDefined();
      expect(screen.getByText('TKT-008')).toBeDefined();
    });
  });
});

// ─── TicketDetail Tests ─────────────────────────────────────────

describe('TicketDetail', () => {
  it('shows loading spinner initially', () => {
    mockGet.mockImplementation(
      () =>
        new Promise(() => {
          /* never resolves */
        }),
    );
    renderTicketDetail('TKT-001');

    expect(screen.getByText('Loading ticket')).toBeDefined();
  });

  it('renders ticket title', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderTicketDetail('TKT-001');

    await waitFor(() => {
      expect(screen.getByText('Agent confidence scores dropping below threshold')).toBeDefined();
    });
  });

  it('renders breadcrumb navigation', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderTicketDetail('TKT-001');

    await waitFor(() => {
      expect(screen.getByLabelText('Breadcrumb')).toBeDefined();
      expect(screen.getByText('Tickets')).toBeDefined();
      expect(screen.getByText('TKT-001')).toBeDefined();
    });
  });

  it('shows ticket status badge', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderTicketDetail('TKT-001');

    await waitFor(() => {
      expect(screen.getByText('Open')).toBeDefined();
    });
  });

  it('shows ticket priority badge', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderTicketDetail('TKT-001');

    await waitFor(() => {
      expect(screen.getByText('High')).toBeDefined();
    });
  });

  it('shows ticket category badge', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderTicketDetail('TKT-001');

    await waitFor(() => {
      // "Bug" appears in badge and possibly in details sidebar
      expect(screen.getAllByText('Bug').length).toBeGreaterThan(0);
    });
  });

  it('shows action buttons', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderTicketDetail('TKT-001');

    await waitFor(() => {
      expect(screen.getByText('Assign')).toBeDefined();
      expect(screen.getByText('Change Status')).toBeDefined();
      expect(screen.getByText('Change Priority')).toBeDefined();
    });
  });

  it('shows reporter in details sidebar', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderTicketDetail('TKT-001');

    await waitFor(() => {
      expect(screen.getByText('Reporter')).toBeDefined();
      // Sarah Chen appears in sidebar and conversation
      expect(screen.getAllByText('Sarah Chen').length).toBeGreaterThan(0);
    });
  });

  it('shows Unassigned when no assignee', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderTicketDetail('TKT-001');

    await waitFor(() => {
      expect(screen.getByText('Unassigned')).toBeDefined();
    });
  });

  it('shows description sidebar', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderTicketDetail('TKT-001');

    await waitFor(() => {
      expect(screen.getByText('Description')).toBeDefined();
      // Description text appears in sidebar and first conversation message
      expect(
        screen.getAllByText(/Collections Agent has been reporting confidence scores/).length,
      ).toBeGreaterThan(0);
    });
  });

  it('shows Conversation section', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderTicketDetail('TKT-001');

    await waitFor(() => {
      expect(screen.getByText('Conversation')).toBeDefined();
    });
  });

  it('renders conversation messages', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderTicketDetail('TKT-001');

    await waitFor(() => {
      // Names appear in conversation and details sidebar
      expect(screen.getAllByText('Sarah Chen').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Priya Sharma').length).toBeGreaterThan(0);
      // System message content
      expect(screen.getByText(/auto-classified as priority/)).toBeDefined();
    });
  });

  it('shows user and admin role badges in conversation', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderTicketDetail('TKT-001');

    await waitFor(() => {
      expect(screen.getAllByText('User').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Admin').length).toBeGreaterThan(0);
    });
  });

  it('shows reply textarea', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderTicketDetail('TKT-001');

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Type your reply... (Ctrl+Enter to send)')).toBeDefined();
    });
  });

  it('shows Send Reply button', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderTicketDetail('TKT-001');

    await waitFor(() => {
      expect(screen.getByText('Send Reply')).toBeDefined();
    });
  });

  it('shows audit trail notice', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderTicketDetail('TKT-001');

    await waitFor(() => {
      expect(
        screen.getByText('Messages are encrypted and logged in the audit trail.'),
      ).toBeDefined();
    });
  });

  it('shows Back to Tickets button', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderTicketDetail('TKT-001');

    await waitFor(() => {
      expect(screen.getByText('Back to Tickets')).toBeDefined();
    });
  });

  it('shows "Ticket not found" for invalid ID', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderTicketDetail('TKT-999');

    await waitFor(() => {
      expect(screen.getByText('Ticket not found.')).toBeDefined();
    });
  });

  it('shows details metadata labels', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderTicketDetail('TKT-003');

    await waitFor(() => {
      expect(screen.getByText('Reporter')).toBeDefined();
      expect(screen.getByText('Assignee')).toBeDefined();
      expect(screen.getByText('Category')).toBeDefined();
      expect(screen.getByText('Created')).toBeDefined();
      expect(screen.getByText('Last Updated')).toBeDefined();
    });
  });

  it('shows assigned ticket with assignee name', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderTicketDetail('TKT-003');

    await waitFor(() => {
      // Priya Sharma appears as assignee in sidebar and as conversation author
      expect(screen.getAllByText('Priya Sharma').length).toBeGreaterThan(0);
    });
  });

  it('opens assign modal', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderTicketDetail('TKT-001');

    await waitFor(() => {
      expect(screen.getByText('Assign')).toBeDefined();
    });

    act(() => {
      fireEvent.click(screen.getByText('Assign'));
    });

    expect(screen.getByText('Assign Ticket')).toBeDefined();
    expect(screen.getByPlaceholderText('Enter team member name')).toBeDefined();
  });

  it('opens change status modal', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderTicketDetail('TKT-001');

    await waitFor(() => {
      expect(screen.getByText('Change Status')).toBeDefined();
    });

    act(() => {
      fireEvent.click(screen.getByText('Change Status'));
    });

    // Button text + modal title create duplicates
    expect(screen.getAllByText('Change Status').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Update Status')).toBeDefined();
  });

  it('opens change priority modal', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderTicketDetail('TKT-001');

    await waitFor(() => {
      expect(screen.getByText('Change Priority')).toBeDefined();
    });

    act(() => {
      fireEvent.click(screen.getByText('Change Priority'));
    });

    // Button text + modal title create duplicates
    expect(screen.getAllByText('Change Priority').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Update Priority')).toBeDefined();
  });

  it('does not show reply form for resolved tickets', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderTicketDetail('TKT-005');

    await waitFor(() => {
      expect(screen.getByText('Question about webhook retry policy')).toBeDefined();
    });

    // The reply form should not be present for resolved tickets
    expect(screen.queryByPlaceholderText('Type your reply... (Ctrl+Enter to send)')).toBeNull();
  });

  it('renders conversation for compliance ticket', async () => {
    mockGet.mockRejectedValue(new Error('fail'));
    renderTicketDetail('TKT-003');

    await waitFor(() => {
      expect(screen.getByText('HIPAA audit log gap detected in staging')).toBeDefined();
      // David Kim appears as reporter in sidebar and as conversation author
      expect(screen.getAllByText('David Kim').length).toBeGreaterThan(0);
      expect(screen.getByText(/Hash chain verification flagged a gap/)).toBeDefined();
      expect(screen.getByText(/P0 alert triggered/)).toBeDefined();
    });
  });
});
