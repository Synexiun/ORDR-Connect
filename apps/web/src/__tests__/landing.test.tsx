/**
 * Landing Page Tests
 *
 * Validates:
 * - "CUSTOMER OPERATIONS OS" tagline rendered
 * - Hero headline ("The autonomous platform")
 * - Hero subtitle mentions "ORDR-Connect"
 * - Navigation items: Industries, Sign In, Request Demo
 * - CTA buttons: "Request a Demo" (hero)
 * - "that replaces CRM." rendered
 * - Renders without crashing (IntersectionObserver mocked)
 *
 * COMPLIANCE: No PHI. Public marketing page.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement } from 'react';
import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';

import { Landing } from '../pages/Landing';

// ─── Setup / Teardown ────────────────────────────────────────────

function renderLanding(): ReturnType<typeof render> {
  return render(createElement(BrowserRouter, null, createElement(Landing)));
}

beforeEach(() => {
  vi.clearAllMocks();
  // Stub browser APIs not available in jsdom — must re-stub each test
  // because afterEach calls vi.unstubAllGlobals()
  vi.stubGlobal(
    'IntersectionObserver',
    vi.fn(() => ({
      observe: vi.fn(),
      unobserve: vi.fn(),
      disconnect: vi.fn(),
    })),
  );
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn((cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    }),
  );
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ─── Tests ───────────────────────────────────────────────────────

describe('Landing page', () => {
  it('renders without crashing', () => {
    expect(() => renderLanding()).not.toThrow();
  });

  it('renders "CUSTOMER OPERATIONS OS" tagline', () => {
    renderLanding();
    expect(screen.getByText('CUSTOMER OPERATIONS OS')).toBeDefined();
  });

  it('renders hero headline fragment "The autonomous platform"', () => {
    renderLanding();
    expect(screen.getByText(/The autonomous platform/i)).toBeDefined();
  });

  it('renders "that replaces CRM." in hero', () => {
    renderLanding();
    expect(screen.getByText(/that replaces CRM\./i)).toBeDefined();
  });

  it('renders nav "Sign In" button', () => {
    renderLanding();
    expect(screen.getByRole('button', { name: 'Sign In' })).toBeDefined();
  });

  it('renders nav "Request Demo" button', () => {
    renderLanding();
    expect(screen.getByRole('button', { name: 'Request Demo' })).toBeDefined();
  });

  it('renders hero CTA "Request a Demo"', () => {
    renderLanding();
    expect(screen.getAllByText(/Request a Demo/i).length).toBeGreaterThan(0);
  });

  it('renders ORDR.Connect logo text in nav', () => {
    renderLanding();
    // Logo uses ORDR + Connect as separate spans
    expect(screen.getAllByText(/ORDR/i).length).toBeGreaterThan(0);
  });

  it('renders "Industries" nav link', () => {
    renderLanding();
    expect(screen.getByText('Industries')).toBeDefined();
  });

  it('renders HIPAA compliance mention', () => {
    renderLanding();
    expect(screen.getAllByText(/HIPAA/i).length).toBeGreaterThan(0);
  });
});
