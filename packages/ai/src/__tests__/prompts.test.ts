import { describe, it, expect } from 'vitest';
import {
  PromptRegistry,
  BUILT_IN_TEMPLATES,
  COMPLIANCE_BLOCKS,
} from '../prompts.js';
import { isOk, isErr } from '@ordr/core';

// ─── COMPLIANCE_BLOCKS ───────────────────────────────────────────

describe('COMPLIANCE_BLOCKS', () => {
  it('BASE block contains HIPAA reference', () => {
    expect(COMPLIANCE_BLOCKS.BASE).toContain('HIPAA');
  });

  it('BASE block contains SOC2 reference', () => {
    expect(COMPLIANCE_BLOCKS.BASE).toContain('SOC2');
  });

  it('FDCPA block contains Mini-Miranda disclosure', () => {
    expect(COMPLIANCE_BLOCKS.FDCPA).toContain('Mini-Miranda');
    expect(COMPLIANCE_BLOCKS.FDCPA).toContain('attempt to collect a debt');
  });

  it('CUSTOMER_COMMUNICATION block has escalation rule', () => {
    expect(COMPLIANCE_BLOCKS.CUSTOMER_COMMUNICATION).toContain('escalate');
  });
});

// ─── BUILT_IN_TEMPLATES ──────────────────────────────────────────

describe('BUILT_IN_TEMPLATES', () => {
  it('contains exactly 4 built-in templates', () => {
    expect(BUILT_IN_TEMPLATES).toHaveLength(4);
  });

  it('all templates have unique IDs', () => {
    const ids = BUILT_IN_TEMPLATES.map((t) => t.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it('all templates have non-empty variables array', () => {
    for (const template of BUILT_IN_TEMPLATES) {
      expect(template.variables.length).toBeGreaterThan(0);
    }
  });

  it('all templates have version 1', () => {
    for (const template of BUILT_IN_TEMPLATES) {
      expect(template.version).toBe(1);
    }
  });

  it('payment_reminder template includes FDCPA compliance', () => {
    const template = BUILT_IN_TEMPLATES.find((t) => t.id === 'collections.payment_reminder');
    expect(template).toBeDefined();
    expect(template?.systemPrompt).toContain('FDCPA');
    expect(template?.systemPrompt).toContain('Mini-Miranda');
  });

  it('all templates use double-brace variables', () => {
    for (const template of BUILT_IN_TEMPLATES) {
      for (const varName of template.variables) {
        expect(template.userTemplate).toContain(`{{${varName}}}`);
      }
    }
  });
});

// ─── PromptRegistry ──────────────────────────────────────────────

describe('PromptRegistry', () => {
  it('initializes with all built-in templates', () => {
    const registry = new PromptRegistry();
    expect(registry.size).toBe(BUILT_IN_TEMPLATES.length);
    for (const template of BUILT_IN_TEMPLATES) {
      expect(registry.has(template.id)).toBe(true);
    }
  });

  it('get() returns template by ID', () => {
    const registry = new PromptRegistry();
    const template = registry.get('collections.payment_reminder');
    expect(template).toBeDefined();
    expect(template?.name).toBe('Payment Reminder');
  });

  it('get() returns undefined for unknown ID', () => {
    const registry = new PromptRegistry();
    expect(registry.get('nonexistent.template')).toBeUndefined();
  });

  it('register() adds new templates', () => {
    const registry = new PromptRegistry();
    const custom = {
      id: 'custom.test',
      name: 'Test Template',
      version: 1,
      systemPrompt: 'System prompt',
      userTemplate: 'Hello {{name}}',
      variables: ['name'] as readonly string[],
    };
    const previous = registry.register(custom);
    expect(previous).toBeUndefined();
    expect(registry.has('custom.test')).toBe(true);
    expect(registry.size).toBe(BUILT_IN_TEMPLATES.length + 1);
  });

  it('register() returns previous template on overwrite', () => {
    const registry = new PromptRegistry();
    const original = registry.get('collections.payment_reminder');
    const updated = {
      ...original!,
      version: 2,
    };
    const previous = registry.register(updated);
    expect(previous).toBeDefined();
    expect(previous?.version).toBe(1);
    expect(registry.get('collections.payment_reminder')?.version).toBe(2);
  });

  it('list() returns all template IDs', () => {
    const registry = new PromptRegistry();
    const ids = registry.list();
    expect(ids.length).toBe(BUILT_IN_TEMPLATES.length);
    expect(ids).toContain('collections.payment_reminder');
    expect(ids).toContain('collections.negotiation');
    expect(ids).toContain('collections.payment_plan');
    expect(ids).toContain('collections.escalation_summary');
  });

  it('has() returns false for missing templates', () => {
    const registry = new PromptRegistry();
    expect(registry.has('does.not.exist')).toBe(false);
  });
});

// ─── PromptRegistry.render() ─────────────────────────────────────

describe('PromptRegistry.render()', () => {
  it('renders template with all variables', () => {
    const registry = new PromptRegistry();
    const result = registry.render('collections.payment_reminder', {
      customer_name: 'John Doe',
      account_number: 'ACC-12345',
      amount_due: '$500.00',
      due_date: '2025-03-15',
      days_past_due: '30',
    });
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.userPrompt).toContain('John Doe');
      expect(result.data.userPrompt).toContain('ACC-12345');
      expect(result.data.userPrompt).toContain('$500.00');
      expect(result.data.userPrompt).not.toContain('{{customer_name}}');
      expect(result.data.systemPrompt).toContain('FDCPA');
    }
  });

  it('returns error for unknown template', () => {
    const registry = new PromptRegistry();
    const result = registry.render('unknown.id', {});
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.message).toContain('not found');
    }
  });

  it('returns error for missing variables', () => {
    const registry = new PromptRegistry();
    const result = registry.render('collections.payment_reminder', {
      customer_name: 'John',
      // missing all other required variables
    });
    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.message).toContain('Missing required variables');
    }
  });

  it('substitutes all variable occurrences', () => {
    const registry = new PromptRegistry();
    registry.register({
      id: 'test.double',
      name: 'Test Double',
      version: 1,
      systemPrompt: 'sys',
      userTemplate: '{{name}} said hello to {{name}}',
      variables: ['name'],
    });
    const result = registry.render('test.double', { name: 'Alice' });
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.userPrompt).toBe('Alice said hello to Alice');
    }
  });

  it('allows extra variables (does not error)', () => {
    const registry = new PromptRegistry();
    registry.register({
      id: 'test.simple',
      name: 'Test Simple',
      version: 1,
      systemPrompt: 'sys',
      userTemplate: 'Hello {{name}}',
      variables: ['name'],
    });
    const result = registry.render('test.simple', {
      name: 'Bob',
      extra: 'ignored',
    });
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.userPrompt).toBe('Hello Bob');
    }
  });
});
