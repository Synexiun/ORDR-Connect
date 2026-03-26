/**
 * Tests for the refactored AgentRole branded type
 *
 * Validates createAgentRole format checking and isWellKnownRole detection.
 */

import { describe, it, expect } from 'vitest';
import {
  createAgentRole,
  isWellKnownRole,
  AGENT_ROLES,
} from '@ordr/core';

describe('createAgentRole', () => {
  it('should accept valid lowercase role names', () => {
    const role = createAgentRole('collections');
    expect(role).toBe('collections');
  });

  it('should accept single-letter role names', () => {
    const role = createAgentRole('a');
    expect(role).toBe('a');
  });

  it('should accept roles with underscores', () => {
    const role = createAgentRole('support_triage');
    expect(role).toBe('support_triage');
  });

  it('should accept roles with numbers', () => {
    const role = createAgentRole('agent2');
    expect(role).toBe('agent2');
  });

  it('should accept roles with mixed alphanumeric and underscores', () => {
    const role = createAgentRole('custom_agent_v2');
    expect(role).toBe('custom_agent_v2');
  });

  it('should accept maximum length role (64 chars)', () => {
    const longRole = 'a' + 'b'.repeat(63);
    const role = createAgentRole(longRole);
    expect(role).toBe(longRole);
  });

  it('should reject empty string', () => {
    expect(() => createAgentRole('')).toThrow();
  });

  it('should reject uppercase characters', () => {
    expect(() => createAgentRole('Collections')).toThrow();
  });

  it('should reject mixed case', () => {
    expect(() => createAgentRole('supportTriage')).toThrow();
  });

  it('should reject hyphens', () => {
    expect(() => createAgentRole('support-triage')).toThrow();
  });

  it('should reject spaces', () => {
    expect(() => createAgentRole('support triage')).toThrow();
  });

  it('should reject special characters', () => {
    expect(() => createAgentRole('agent@role')).toThrow();
  });

  it('should reject dots', () => {
    expect(() => createAgentRole('agent.role')).toThrow();
  });

  it('should reject role starting with a number', () => {
    expect(() => createAgentRole('2agent')).toThrow();
  });

  it('should reject role starting with an underscore', () => {
    expect(() => createAgentRole('_agent')).toThrow();
  });

  it('should reject names exceeding 64 characters', () => {
    const tooLong = 'a' + 'b'.repeat(64);
    expect(() => createAgentRole(tooLong)).toThrow();
  });

  it('should reject whitespace-only strings', () => {
    expect(() => createAgentRole('   ')).toThrow();
  });

  it('should produce a branded string type', () => {
    const role = createAgentRole('test_role');
    // At runtime, it's still a string
    expect(typeof role).toBe('string');
    expect(role).toBe('test_role');
  });
});

describe('isWellKnownRole', () => {
  it('should return true for all built-in roles', () => {
    for (const roleName of AGENT_ROLES) {
      const role = createAgentRole(roleName);
      expect(isWellKnownRole(role)).toBe(true);
    }
  });

  it('should return true for collections', () => {
    expect(isWellKnownRole(createAgentRole('collections'))).toBe(true);
  });

  it('should return true for support_triage', () => {
    expect(isWellKnownRole(createAgentRole('support_triage'))).toBe(true);
  });

  it('should return true for escalation', () => {
    expect(isWellKnownRole(createAgentRole('escalation'))).toBe(true);
  });

  it('should return true for lead_qualifier', () => {
    expect(isWellKnownRole(createAgentRole('lead_qualifier'))).toBe(true);
  });

  it('should return false for custom roles', () => {
    expect(isWellKnownRole(createAgentRole('custom_agent'))).toBe(false);
  });

  it('should return false for roles similar to but not matching built-ins', () => {
    expect(isWellKnownRole(createAgentRole('collection'))).toBe(false);
  });

  it('should return false for plugin-registered custom roles', () => {
    expect(isWellKnownRole(createAgentRole('medical_debt_handler'))).toBe(false);
  });

  it('should handle all 8 well-known roles', () => {
    expect(AGENT_ROLES).toHaveLength(8);
    const knownCount = AGENT_ROLES.filter(r =>
      isWellKnownRole(createAgentRole(r)),
    ).length;
    expect(knownCount).toBe(8);
  });
});
