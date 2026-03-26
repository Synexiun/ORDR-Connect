/**
 * Branded Email Tests — injectBranding, EmailProvider with branding
 *
 * COMPLIANCE:
 * - No secrets in branded templates (Rule 5)
 * - No PHI in branding wrapper (Rule 6)
 * - CAN-SPAM: Unsubscribe link always present
 * - HTML escaping prevents injection
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { injectBranding, DEFAULT_BRANDED_EMAIL_OPTIONS, EmailProvider } from '../email.js';
import type { BrandedEmailOptions, SendGridClient } from '../email.js';

// ─── Test Fixtures ──────────────────────────────────────────────

const testBrand: BrandedEmailOptions = {
  logoUrl: 'https://example.com/logo.png',
  primaryColor: '#ff0000',
  accentColor: '#00ff00',
  bgColor: '#111111',
  textColor: '#eeeeee',
  footerText: 'Acme Corp - All rights reserved',
  fromName: 'Acme Support',
  fromAddress: 'support@acme.com',
};

const minimalBrand: BrandedEmailOptions = {
  logoUrl: null,
  primaryColor: '#3b82f6',
  accentColor: '#10b981',
  bgColor: '#0f172a',
  textColor: '#e2e8f0',
  footerText: null,
  fromName: null,
  fromAddress: null,
};

// ─── injectBranding ─────────────────────────────────────────────

describe('injectBranding', () => {
  it('wraps content in a complete HTML document', () => {
    const result = injectBranding('<p>Hello</p>', testBrand);
    expect(result).toContain('<!DOCTYPE html>');
    expect(result).toContain('<html');
    expect(result).toContain('</html>');
  });

  it('includes the original content', () => {
    const content = '<p>Test email content with <strong>bold text</strong></p>';
    const result = injectBranding(content, testBrand);
    expect(result).toContain(content);
  });

  it('adds logo when logoUrl is provided', () => {
    const result = injectBranding('<p>Content</p>', testBrand);
    expect(result).toContain('img');
    expect(result).toContain('https://example.com/logo.png');
  });

  it('omits logo when logoUrl is null', () => {
    const result = injectBranding('<p>Content</p>', minimalBrand);
    expect(result).not.toContain('<img');
  });

  it('adds footer text when provided', () => {
    const result = injectBranding('<p>Content</p>', testBrand);
    expect(result).toContain('Acme Corp - All rights reserved');
  });

  it('omits footer text when null', () => {
    const result = injectBranding('<p>Content</p>', minimalBrand);
    // Should not contain a footer paragraph (the unsubscribe link is separate)
    expect(result).not.toContain('All rights reserved');
  });

  it('applies bgColor to body background', () => {
    const result = injectBranding('<p>Content</p>', testBrand);
    expect(result).toContain('background-color:#111111');
  });

  it('applies textColor to content area', () => {
    const result = injectBranding('<p>Content</p>', testBrand);
    expect(result).toContain('color:#eeeeee');
  });

  it('applies accentColor to header border', () => {
    const result = injectBranding('<p>Content</p>', testBrand);
    expect(result).toContain('#00ff00');
  });

  it('applies primaryColor to footer border', () => {
    const result = injectBranding('<p>Content</p>', testBrand);
    expect(result).toContain('#ff0000');
  });

  it('always includes unsubscribe link (CAN-SPAM)', () => {
    const result = injectBranding('<p>Content</p>', testBrand);
    expect(result).toContain('Unsubscribe');
    expect(result).toContain('unsubscribe_url');
  });

  it('includes unsubscribe link even with minimal branding', () => {
    const result = injectBranding('<p>Content</p>', minimalBrand);
    expect(result).toContain('Unsubscribe');
  });

  it('escapes HTML in logo URL to prevent injection', () => {
    const maliciousBrand: BrandedEmailOptions = {
      ...testBrand,
      logoUrl: 'https://example.com/logo.png" onload="alert(1)',
    };

    const result = injectBranding('<p>Content</p>', maliciousBrand);
    expect(result).not.toContain('"onload="alert(1)');
    expect(result).toContain('&quot;');
  });

  it('escapes HTML in footer text to prevent injection', () => {
    const maliciousBrand: BrandedEmailOptions = {
      ...testBrand,
      footerText: '<script>alert("xss")</script>',
    };

    const result = injectBranding('<p>Content</p>', maliciousBrand);
    expect(result).not.toContain('<script>');
    expect(result).toContain('&lt;script&gt;');
  });

  it('escapes HTML in color values', () => {
    const maliciousBrand: BrandedEmailOptions = {
      ...testBrand,
      bgColor: '#000"><script>alert(1)</script>',
    };

    const result = injectBranding('<p>Content</p>', maliciousBrand);
    expect(result).not.toContain('<script>alert(1)</script>');
  });

  it('handles empty content string', () => {
    const result = injectBranding('', testBrand);
    expect(result).toContain('<!DOCTYPE html>');
    // The template still renders even with empty content
    expect(result).toContain('Unsubscribe');
  });

  it('preserves complex HTML content', () => {
    const complexContent = `
      <h1>Welcome!</h1>
      <p>Dear customer,</p>
      <table><tr><td>Item</td><td>Price</td></tr></table>
      <a href="https://example.com">Click here</a>
    `;
    const result = injectBranding(complexContent, testBrand);
    expect(result).toContain('<h1>Welcome!</h1>');
    expect(result).toContain('<table>');
    expect(result).toContain('https://example.com');
  });
});

// ─── DEFAULT_BRANDED_EMAIL_OPTIONS ──────────────────────────────

describe('DEFAULT_BRANDED_EMAIL_OPTIONS', () => {
  it('has ORDR-Connect default colors', () => {
    expect(DEFAULT_BRANDED_EMAIL_OPTIONS.primaryColor).toBe('#3b82f6');
    expect(DEFAULT_BRANDED_EMAIL_OPTIONS.accentColor).toBe('#10b981');
    expect(DEFAULT_BRANDED_EMAIL_OPTIONS.bgColor).toBe('#0f172a');
    expect(DEFAULT_BRANDED_EMAIL_OPTIONS.textColor).toBe('#e2e8f0');
  });

  it('has null for optional fields', () => {
    expect(DEFAULT_BRANDED_EMAIL_OPTIONS.logoUrl).toBeNull();
    expect(DEFAULT_BRANDED_EMAIL_OPTIONS.footerText).toBeNull();
    expect(DEFAULT_BRANDED_EMAIL_OPTIONS.fromName).toBeNull();
    expect(DEFAULT_BRANDED_EMAIL_OPTIONS.fromAddress).toBeNull();
  });
});

// ─── EmailProvider with branding ────────────────────────────────

describe('EmailProvider — branded send', () => {
  let client: SendGridClient;
  let provider: EmailProvider;

  beforeEach(() => {
    client = {
      send: vi.fn().mockResolvedValue({
        statusCode: 202,
        headers: {},
        messageId: 'sg_msg_branded_001',
      }),
    };

    provider = new EmailProvider({
      client,
      fromEmail: 'default@ordr-connect.com',
      fromName: 'ORDR Connect',
    });
  });

  it('sends branded email when branding options are provided', async () => {
    const result = await provider.send(
      'user@example.com',
      'Welcome',
      '<p>Hello!</p>',
      undefined,
      testBrand,
    );

    expect(result.success).toBe(true);
    expect(client.send).toHaveBeenCalledTimes(1);

    const sentMessage = (client.send as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(sentMessage.html).toContain('<!DOCTYPE html>');
    expect(sentMessage.html).toContain('<p>Hello!</p>');
    expect(sentMessage.html).toContain('logo.png');
  });

  it('uses brand fromAddress when provided', async () => {
    await provider.send(
      'user@example.com',
      'Welcome',
      '<p>Hello!</p>',
      undefined,
      testBrand,
    );

    const sentMessage = (client.send as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(sentMessage.from.email).toBe('support@acme.com');
    expect(sentMessage.from.name).toBe('Acme Support');
  });

  it('falls back to default from when brand fromAddress is null', async () => {
    await provider.send(
      'user@example.com',
      'Welcome',
      '<p>Hello!</p>',
      undefined,
      minimalBrand,
    );

    const sentMessage = (client.send as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(sentMessage.from.email).toBe('default@ordr-connect.com');
    expect(sentMessage.from.name).toBe('ORDR Connect');
  });

  it('sends unbranded email when branding is not provided', async () => {
    await provider.send(
      'user@example.com',
      'Welcome',
      '<p>Hello!</p>',
    );

    const sentMessage = (client.send as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(sentMessage.html).toBe('<p>Hello!</p>');
    expect(sentMessage.html).not.toContain('<!DOCTYPE html>');
  });

  it('combines EmailOptions and BrandedEmailOptions correctly', async () => {
    await provider.send(
      'user@example.com',
      'Welcome',
      '<p>Hello!</p>',
      { replyTo: 'reply@acme.com', trackingEnabled: true },
      testBrand,
    );

    const sentMessage = (client.send as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(sentMessage.replyTo).toBe('reply@acme.com');
    expect(sentMessage.trackingSettings?.clickTracking?.enable).toBe(true);
    expect(sentMessage.html).toContain('<!DOCTYPE html>');
  });
});
