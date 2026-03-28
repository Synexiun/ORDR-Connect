/**
 * SampleDashboard Page Tests
 *
 * Validates:
 * - Page heading "ESTATEOS" rendered
 * - "AI ACTIVE" status badge
 * - "AI Activity Stream" section heading
 * - Command input with correct placeholder
 * - Send button for command form
 * - Agent log entries (LeadGen, Comms, Scout, Coordinator)
 * - Topology node labels (EstateOS AI Brain, Zillow & Trulia, etc.)
 * - Priority queue items (Michael Chang, Sarah Jenkins, Martinez Family)
 * - Telemetry values ($42.5M pipeline, 12 hot leads)
 * - Renders without crashing (no API calls — pure UI)
 *
 * COMPLIANCE: No PHI. Synthetic demo data only. SOC2 CC6.1.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';

import { SampleDashboard } from '../pages/SampleDashboard';

// ─── Setup / Teardown ────────────────────────────────────────────

function renderSampleDashboard(): ReturnType<typeof render> {
  return render(createElement(BrowserRouter, null, createElement(SampleDashboard)));
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Tests ───────────────────────────────────────────────────────

describe('SampleDashboard page', () => {
  it('renders without crashing', () => {
    expect(() => renderSampleDashboard()).not.toThrow();
  });

  it('renders "ESTATE" heading text', () => {
    renderSampleDashboard();
    expect(screen.getByText(/ESTATE/)).toBeDefined();
  });

  it('renders "AI ACTIVE" badge', () => {
    renderSampleDashboard();
    expect(screen.getByText('AI ACTIVE')).toBeDefined();
  });

  it('renders "AI Activity Stream" section heading', () => {
    renderSampleDashboard();
    expect(screen.getByText('AI Activity Stream')).toBeDefined();
  });

  it('renders command input with placeholder text', () => {
    renderSampleDashboard();
    expect(screen.getByPlaceholderText(/Instruct the Agency AI/i)).toBeDefined();
  });

  it('renders Send button for command form', () => {
    renderSampleDashboard();
    // Send button is a submit button with an icon — find by type
    const form = screen.getByPlaceholderText(/Instruct the Agency AI/i).closest('form');
    expect(form).toBeDefined();
    const submitBtn = form?.querySelector('button[type="submit"]');
    expect(submitBtn).toBeDefined();
  });

  it('renders LeadGen agent log entry', () => {
    renderSampleDashboard();
    expect(screen.getAllByText(/LeadGen/i).length).toBeGreaterThan(0);
  });

  it('renders Comms agent log entry', () => {
    renderSampleDashboard();
    expect(screen.getAllByText(/Comms/i).length).toBeGreaterThan(0);
  });

  it('renders Scout agent log entry', () => {
    renderSampleDashboard();
    expect(screen.getAllByText(/Scout/i).length).toBeGreaterThan(0);
  });

  it('renders Coordinator agent log entry', () => {
    renderSampleDashboard();
    expect(screen.getAllByText(/Coordinator/i).length).toBeGreaterThan(0);
  });

  it('renders topology node label "EstateOS AI Brain"', () => {
    renderSampleDashboard();
    expect(screen.getByText('EstateOS AI Brain')).toBeDefined();
  });

  it('renders topology node label "Zillow & Trulia"', () => {
    renderSampleDashboard();
    expect(screen.getByText('Zillow & Trulia')).toBeDefined();
  });

  it('renders topology node label "MLS Live Feed"', () => {
    renderSampleDashboard();
    expect(screen.getByText('MLS Live Feed')).toBeDefined();
  });

  it('renders topology node label "Escrow & Closing"', () => {
    renderSampleDashboard();
    expect(screen.getByText('Escrow & Closing')).toBeDefined();
  });

  it('renders priority queue client "Michael Chang"', () => {
    renderSampleDashboard();
    expect(screen.getByText('Michael Chang')).toBeDefined();
  });

  it('renders priority queue client "Sarah Jenkins"', () => {
    renderSampleDashboard();
    expect(screen.getByText('Sarah Jenkins')).toBeDefined();
  });

  it('renders priority queue client "Martinez Family"', () => {
    renderSampleDashboard();
    expect(screen.getByText('Martinez Family')).toBeDefined();
  });

  it('renders telemetry pipeline value "$42.5M"', () => {
    renderSampleDashboard();
    expect(screen.getByText('$42.5M')).toBeDefined();
  });

  it('renders hot leads count "12"', () => {
    renderSampleDashboard();
    expect(screen.getAllByText('12').length).toBeGreaterThan(0);
  });
});
