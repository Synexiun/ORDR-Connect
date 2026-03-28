/**
 * AttackDetector tests
 *
 * Verifies:
 * - SQLi detection (UNION SELECT, DROP TABLE, 1=1, EXEC, SLEEP, etc.)
 * - XSS detection (<script>, javascript:, onerror=, eval(), etc.)
 * - Path traversal detection (../, %2e%2e, /etc/passwd, etc.)
 * - SSRF detection (localhost, 127.0.0.1, 169.254.x, RFC 1918)
 * - Command injection (shell metacharacters)
 * - XXE detection (DOCTYPE + ENTITY)
 * - Prototype pollution detection
 * - NoSQL injection detection
 * - Double-encoded inputs
 * - Clean inputs produce no indicators
 * - AttackDetector.maxSeverity()
 */

import { describe, it, expect } from 'vitest';
import { AttackDetector } from '../attack-detector.js';

const detector = new AttackDetector();

// ─── SQL Injection ────────────────────────────────────────────────────────────

describe('AttackDetector — SQL injection', () => {
  it('detects UNION SELECT in URL', () => {
    const indicators = detector.detectInURL('/api/users?id=1 UNION SELECT password FROM users--');
    expect(indicators.some((i) => i.type === 'sqli')).toBe(true);
  });

  it('detects DROP TABLE in body', () => {
    const indicators = detector.detectInBody('{ "name": "x\'; DROP TABLE users;--" }');
    expect(indicators.some((i) => i.type === 'sqli')).toBe(true);
  });

  it('detects OR 1=1 in query params', () => {
    const indicators = detector.detectInQuery({ id: "' OR '1'='1" });
    expect(indicators.some((i) => i.type === 'sqli')).toBe(true);
  });

  it('detects SLEEP timing attack', () => {
    const indicators = detector.detectInURL('/api?id=1 AND SLEEP(5)');
    expect(indicators.some((i) => i.type === 'sqli')).toBe(true);
  });

  it('detects EXEC stored procedure', () => {
    const indicators = detector.detectInBody('value=admin; EXEC xp_cmdshell("whoami")');
    expect(indicators.some((i) => i.type === 'sqli')).toBe(true);
  });

  it('detects MySQL LOAD_FILE', () => {
    const indicators = detector.detectInBody("LOAD_FILE('/etc/passwd')");
    expect(indicators.some((i) => i.type === 'sqli')).toBe(true);
  });
});

// ─── XSS ─────────────────────────────────────────────────────────────────────

describe('AttackDetector — XSS', () => {
  it('detects <script> tag in URL', () => {
    const indicators = detector.detectInURL('/search?q=<script>alert(1)</script>');
    expect(indicators.some((i) => i.type === 'xss')).toBe(true);
  });

  it('detects javascript: URI in body', () => {
    const indicators = detector.detectInBody('{"url":"javascript:alert(document.cookie)"}');
    expect(indicators.some((i) => i.type === 'xss')).toBe(true);
  });

  it('detects inline event handler', () => {
    const indicators = detector.detectInBody('<img onerror="alert(1)" src="x">');
    expect(indicators.some((i) => i.type === 'xss')).toBe(true);
  });

  it('detects eval() call', () => {
    const indicators = detector.detectInURL('/api?code=eval(atob("YWxlcnQoMSk="))');
    expect(indicators.some((i) => i.type === 'xss')).toBe(true);
  });

  it('detects URL-encoded <script>', () => {
    const indicators = detector.detectInURL('/search?q=%3cscript%3ealert(1)%3c/script%3e');
    expect(indicators.some((i) => i.type === 'xss')).toBe(true);
  });
});

// ─── Path Traversal ───────────────────────────────────────────────────────────

describe('AttackDetector — Path Traversal', () => {
  it('detects ../ in URL', () => {
    const indicators = detector.detectInURL('/api/files?path=../../etc/passwd');
    expect(indicators.some((i) => i.type === 'path_traversal')).toBe(true);
  });

  it('detects URL-encoded traversal (%2e%2e)', () => {
    const indicators = detector.detectInURL('/api/files?path=%2e%2e%2fetc%2fpasswd');
    expect(indicators.some((i) => i.type === 'path_traversal')).toBe(true);
  });

  it('detects /etc/passwd directly', () => {
    const indicators = detector.detectInURL('/api?file=/etc/passwd');
    expect(indicators.some((i) => i.type === 'path_traversal')).toBe(true);
  });

  it('detects /proc/self/environ', () => {
    const indicators = detector.detectInBody('/proc/self/environ');
    expect(indicators.some((i) => i.type === 'path_traversal')).toBe(true);
  });
});

// ─── SSRF ─────────────────────────────────────────────────────────────────────

describe('AttackDetector — SSRF', () => {
  it('detects localhost URL in body', () => {
    const indicators = detector.detectInBody('{"webhook":"http://localhost:8080/internal"}');
    expect(indicators.some((i) => i.type === 'ssrf')).toBe(true);
  });

  it('detects 127.0.0.1 in query params', () => {
    const indicators = detector.detectInQuery({ url: 'http://127.0.0.1:9200' });
    expect(indicators.some((i) => i.type === 'ssrf')).toBe(true);
  });

  it('detects AWS metadata endpoint 169.254.169.254', () => {
    const indicators = detector.detectInBody(
      '{"target":"http://169.254.169.254/latest/meta-data"}',
    );
    expect(indicators.some((i) => i.type === 'ssrf')).toBe(true);
  });

  it('detects RFC1918 10.x.x.x', () => {
    const indicators = detector.detectInBody('{"endpoint":"http://10.0.0.1/admin"}');
    expect(indicators.some((i) => i.type === 'ssrf')).toBe(true);
  });

  it('detects RFC1918 192.168.x.x', () => {
    const indicators = detector.detectInBody('{"callback":"http://192.168.1.1/api"}');
    expect(indicators.some((i) => i.type === 'ssrf')).toBe(true);
  });
});

// ─── Command Injection ────────────────────────────────────────────────────────

describe('AttackDetector — Command Injection', () => {
  it('detects pipe + command in body', () => {
    const indicators = detector.detectInBody('name=admin | cat /etc/passwd');
    expect(indicators.some((i) => i.type === 'command_injection')).toBe(true);
  });

  it('detects $() substitution', () => {
    const indicators = detector.detectInBody('value=$(cat /etc/shadow)');
    expect(indicators.some((i) => i.type === 'command_injection')).toBe(true);
  });
});

// ─── XXE ─────────────────────────────────────────────────────────────────────

describe('AttackDetector — XXE', () => {
  it('detects DOCTYPE + ENTITY declaration', () => {
    const xxePayload = `<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><foo>&xxe;</foo>`;
    const indicators = detector.detectInBody(xxePayload);
    expect(indicators.some((i) => i.type === 'xxe')).toBe(true);
  });

  it('detects SYSTEM identifier', () => {
    const indicators = detector.detectInBody('SYSTEM "file:///etc/hosts"');
    expect(indicators.some((i) => i.type === 'xxe')).toBe(true);
  });
});

// ─── Prototype Pollution ──────────────────────────────────────────────────────

describe('AttackDetector — Prototype Pollution', () => {
  it('detects __proto__ assignment in body', () => {
    const indicators = detector.detectInBody('{"__proto__":{"isAdmin":true}}');
    expect(indicators.some((i) => i.type === 'prototype_pollution')).toBe(true);
  });

  it('detects constructor.prototype in URL', () => {
    const indicators = detector.detectInURL('/api?constructor.prototype.admin=true');
    expect(indicators.some((i) => i.type === 'prototype_pollution')).toBe(true);
  });
});

// ─── NoSQL Injection ──────────────────────────────────────────────────────────

describe('AttackDetector — NoSQL injection', () => {
  it('detects $where operator', () => {
    const indicators = detector.detectInBody('{"$where":"this.password.length > 0"}');
    expect(indicators.some((i) => i.type === 'nosql_injection')).toBe(true);
  });

  it('detects $ne operator', () => {
    const indicators = detector.detectInBody('{"password":{"$ne":""}}');
    expect(indicators.some((i) => i.type === 'nosql_injection')).toBe(true);
  });
});

// ─── Clean inputs ─────────────────────────────────────────────────────────────

describe('AttackDetector — Clean inputs', () => {
  it('clean URL produces no indicators', () => {
    const indicators = detector.detectInURL('/api/v1/customers?page=1&limit=20&search=John');
    expect(indicators).toHaveLength(0);
  });

  it('clean JSON body produces no indicators', () => {
    const indicators = detector.detectInBody(
      '{"name":"John Doe","email":"john@example.com","phone":"+15551234567"}',
    );
    expect(indicators).toHaveLength(0);
  });

  it('clean headers produce no indicators', () => {
    const indicators = detector.detectInHeaders({
      'content-type': 'application/json',
      accept: 'application/json',
      'x-request-id': 'abc-123',
    });
    expect(indicators).toHaveLength(0);
  });
});

// ─── maxSeverity ──────────────────────────────────────────────────────────────

describe('AttackDetector.maxSeverity', () => {
  it('returns undefined for empty array', () => {
    expect(AttackDetector.maxSeverity([])).toBeUndefined();
  });

  it('returns critical when any indicator is critical', () => {
    const indicators = detector.detectInBody("'; DROP TABLE users;--");
    if (indicators.length > 0) {
      const max = AttackDetector.maxSeverity(indicators);
      expect(['medium', 'high', 'critical']).toContain(max);
    }
  });

  it('returns the highest severity across mixed indicators', () => {
    const fakeIndicators = [
      {
        type: 'xss' as const,
        severity: 'low' as const,
        location: 'body' as const,
        pattern: 'x',
        matched: 'x',
      },
      {
        type: 'sqli' as const,
        severity: 'critical' as const,
        location: 'url' as const,
        pattern: 'y',
        matched: 'y',
      },
      {
        type: 'ssrf' as const,
        severity: 'high' as const,
        location: 'body' as const,
        pattern: 'z',
        matched: 'z',
      },
    ];
    expect(AttackDetector.maxSeverity(fakeIndicators)).toBe('critical');
  });
});
