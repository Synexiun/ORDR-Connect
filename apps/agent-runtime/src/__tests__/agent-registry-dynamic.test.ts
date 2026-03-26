/**
 * Tests for AgentRegistry dynamic registration (SDK Plugin Support)
 *
 * COMPLIANCE (Rule 9): Validates that dynamic agent registration enforces
 * manifest validation, duplicate checks, tool verification, and built-in
 * agent protection.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import { isOk, isErr, ok } from '@ordr/core';
import { AgentRegistry } from '../agent-registry.js';
import type { PromptBuilder } from '../agent-registry.js';
import type { AgentTool } from '../types.js';

// ─── Helpers ───────────────────────────────────────────────────

function makeMockTool(name: string): AgentTool {
  return {
    name,
    description: `Mock ${name} tool`,
    parameters: z.object({}),
    execute: vi.fn().mockResolvedValue(ok({ status: 'ok' })),
  };
}

function makeMockPromptBuilder(): PromptBuilder {
  return vi.fn().mockReturnValue([
    { role: 'system' as const, content: 'Dynamic agent prompt' },
  ]);
}

function makeValidManifest(overrides: Partial<{
  name: string;
  version: string;
  description: string;
  requiredTools: readonly string[];
  minConfidenceThreshold: number;
  maxBudget: {
    maxTokens: number;
    maxCostCents: number;
    maxActions: number;
  };
}> = {}) {
  return {
    name: 'custom_agent',
    version: '1.0.0',
    description: 'A dynamically registered agent',
    requiredTools: ['custom_tool'] as readonly string[],
    minConfidenceThreshold: 0.8,
    maxBudget: {
      maxTokens: 50_000,
      maxCostCents: 200,
      maxActions: 15,
    },
    ...overrides,
  };
}

// ─── Test Variables ────────────────────────────────────────────

let registry: AgentRegistry;

// ─── registerFromManifest ──────────────────────────────────────

describe('AgentRegistry — registerFromManifest', () => {
  beforeEach(() => {
    registry = new AgentRegistry();
  });

  it('should register a valid dynamic agent', () => {
    const manifest = makeValidManifest();
    const tools = [makeMockTool('custom_tool')];
    const result = registry.registerFromManifest(manifest, makeMockPromptBuilder(), tools);
    expect(isOk(result)).toBe(true);
  });

  it('should make registered agent visible in getAllRoles()', () => {
    const manifest = makeValidManifest();
    const tools = [makeMockTool('custom_tool')];
    registry.registerFromManifest(manifest, makeMockPromptBuilder(), tools);
    expect(registry.getAllRoles()).toContain('custom_agent');
  });

  it('should make registered agent retrievable via getConfig()', () => {
    const manifest = makeValidManifest();
    const tools = [makeMockTool('custom_tool')];
    registry.registerFromManifest(manifest, makeMockPromptBuilder(), tools);
    const config = registry.getConfig('custom_agent');
    expect(config).toBeDefined();
    expect(config?.displayName).toBe('custom_agent');
  });

  it('should reject invalid agent name format (hyphens)', () => {
    const manifest = makeValidManifest({ name: 'custom-agent' });
    const tools = [makeMockTool('custom_tool')];
    const result = registry.registerFromManifest(manifest, makeMockPromptBuilder(), tools);
    expect(isErr(result)).toBe(true);
  });

  it('should reject invalid agent name format (uppercase)', () => {
    const manifest = makeValidManifest({ name: 'CustomAgent' });
    const tools = [makeMockTool('custom_tool')];
    const result = registry.registerFromManifest(manifest, makeMockPromptBuilder(), tools);
    expect(isErr(result)).toBe(true);
  });

  it('should reject invalid agent name format (special chars)', () => {
    const manifest = makeValidManifest({ name: 'agent@v1' });
    const tools = [makeMockTool('custom_tool')];
    const result = registry.registerFromManifest(manifest, makeMockPromptBuilder(), tools);
    expect(isErr(result)).toBe(true);
  });

  it('should reject invalid agent name format (empty)', () => {
    const manifest = makeValidManifest({ name: '' });
    const tools = [makeMockTool('custom_tool')];
    const result = registry.registerFromManifest(manifest, makeMockPromptBuilder(), tools);
    expect(isErr(result)).toBe(true);
  });

  it('should reject duplicate agent name', () => {
    const manifest = makeValidManifest();
    const tools = [makeMockTool('custom_tool')];
    const first = registry.registerFromManifest(manifest, makeMockPromptBuilder(), tools);
    expect(isOk(first)).toBe(true);

    const second = registry.registerFromManifest(manifest, makeMockPromptBuilder(), tools);
    expect(isErr(second)).toBe(true);
  });

  it('should reject registration that conflicts with built-in name', () => {
    const manifest = makeValidManifest({ name: 'collections' });
    const tools = [makeMockTool('custom_tool')];
    const result = registry.registerFromManifest(manifest, makeMockPromptBuilder(), tools);
    expect(isErr(result)).toBe(true);
  });

  it('should reject registration when required tools are missing', () => {
    const manifest = makeValidManifest({ requiredTools: ['missing_tool'] });
    const tools: AgentTool[] = []; // No tools provided
    const result = registry.registerFromManifest(manifest, makeMockPromptBuilder(), tools);
    expect(isErr(result)).toBe(true);
  });

  it('should reject registration when some required tools are missing', () => {
    const manifest = makeValidManifest({
      requiredTools: ['tool_a', 'tool_b'],
    });
    const tools = [makeMockTool('tool_a')]; // Only one of two provided
    const result = registry.registerFromManifest(manifest, makeMockPromptBuilder(), tools);
    expect(isErr(result)).toBe(true);
  });

  it('should accept registration with empty requiredTools', () => {
    const manifest = makeValidManifest({ requiredTools: [] });
    const tools: AgentTool[] = [];
    const result = registry.registerFromManifest(manifest, makeMockPromptBuilder(), tools);
    expect(isOk(result)).toBe(true);
  });

  it('should set correct tool allowlist from manifest', () => {
    const manifest = makeValidManifest({
      requiredTools: ['tool_alpha', 'tool_beta'],
    });
    const tools = [makeMockTool('tool_alpha'), makeMockTool('tool_beta')];
    registry.registerFromManifest(manifest, makeMockPromptBuilder(), tools);

    const config = registry.getConfig('custom_agent');
    expect(config?.toolAllowlist).toContain('tool_alpha');
    expect(config?.toolAllowlist).toContain('tool_beta');
  });

  it('should set correct budget limits from manifest', () => {
    const manifest = makeValidManifest({
      maxBudget: {
        maxTokens: 75_000,
        maxCostCents: 300,
        maxActions: 25,
      },
    });
    const tools = [makeMockTool('custom_tool')];
    registry.registerFromManifest(manifest, makeMockPromptBuilder(), tools);

    const config = registry.getConfig('custom_agent');
    expect(config?.maxTokensBudget).toBe(75_000);
    expect(config?.maxCostCentsBudget).toBe(300);
    expect(config?.maxActions).toBe(25);
  });

  it('should register the prompt builder for the agent', () => {
    const manifest = makeValidManifest();
    const tools = [makeMockTool('custom_tool')];
    const promptBuilder = makeMockPromptBuilder();
    registry.registerFromManifest(manifest, promptBuilder, tools);

    const builder = registry.getPromptBuilderForRole('custom_agent');
    expect(builder).toBe(promptBuilder);
  });

  it('should set default autonomy level to supervised', () => {
    const manifest = makeValidManifest();
    const tools = [makeMockTool('custom_tool')];
    registry.registerFromManifest(manifest, makeMockPromptBuilder(), tools);

    const config = registry.getConfig('custom_agent');
    expect(config?.defaultAutonomyLevel).toBe('supervised');
  });

  it('should set max autonomy level to supervised', () => {
    const manifest = makeValidManifest();
    const tools = [makeMockTool('custom_tool')];
    registry.registerFromManifest(manifest, makeMockPromptBuilder(), tools);

    const config = registry.getConfig('custom_agent');
    expect(config?.maxAutonomyLevel).toBe('supervised');
  });

  it('should enable the agent by default', () => {
    const manifest = makeValidManifest();
    const tools = [makeMockTool('custom_tool')];
    registry.registerFromManifest(manifest, makeMockPromptBuilder(), tools);

    expect(registry.isRoleEnabled('custom_agent', 'tenant-1')).toBe(true);
  });

  it('should include version in system prompt template', () => {
    const manifest = makeValidManifest({ version: '2.5.0' });
    const tools = [makeMockTool('custom_tool')];
    registry.registerFromManifest(manifest, makeMockPromptBuilder(), tools);

    const config = registry.getConfig('custom_agent');
    expect(config?.systemPromptTemplate).toContain('2.5.0');
  });

  it('should include description in system prompt template', () => {
    const manifest = makeValidManifest({ description: 'Special handler' });
    const tools = [makeMockTool('custom_tool')];
    registry.registerFromManifest(manifest, makeMockPromptBuilder(), tools);

    const config = registry.getConfig('custom_agent');
    expect(config?.systemPromptTemplate).toContain('Special handler');
  });

  it('should register multiple distinct dynamic agents', () => {
    const manifest1 = makeValidManifest({ name: 'agent_alpha' });
    const manifest2 = makeValidManifest({ name: 'agent_beta' });
    const tools = [makeMockTool('custom_tool')];

    const r1 = registry.registerFromManifest(manifest1, makeMockPromptBuilder(), tools);
    const r2 = registry.registerFromManifest(manifest2, makeMockPromptBuilder(), tools);

    expect(isOk(r1)).toBe(true);
    expect(isOk(r2)).toBe(true);
    expect(registry.getAllRoles()).toContain('agent_alpha');
    expect(registry.getAllRoles()).toContain('agent_beta');
  });
});

// ─── unregister ────────────────────────────────────────────────

describe('AgentRegistry — unregister', () => {
  beforeEach(() => {
    registry = new AgentRegistry();
  });

  it('should remove a dynamically registered agent', () => {
    const manifest = makeValidManifest();
    const tools = [makeMockTool('custom_tool')];
    registry.registerFromManifest(manifest, makeMockPromptBuilder(), tools);
    expect(registry.getConfig('custom_agent')).toBeDefined();

    const result = registry.unregister('custom_agent');
    expect(isOk(result)).toBe(true);
    expect(registry.getConfig('custom_agent')).toBeUndefined();
  });

  it('should block removal of built-in collections agent', () => {
    const result = registry.unregister('collections');
    expect(isErr(result)).toBe(true);
  });

  it('should block removal of built-in support_triage agent', () => {
    const result = registry.unregister('support_triage');
    expect(isErr(result)).toBe(true);
  });

  it('should block removal of built-in escalation agent', () => {
    const result = registry.unregister('escalation');
    expect(isErr(result)).toBe(true);
  });

  it('should fail for agent that was never registered', () => {
    const result = registry.unregister('nonexistent_agent');
    expect(isErr(result)).toBe(true);
  });

  it('should fail for invalid name format', () => {
    const result = registry.unregister('INVALID');
    expect(isErr(result)).toBe(true);
  });

  it('should remove prompt builder along with config', () => {
    const manifest = makeValidManifest();
    const tools = [makeMockTool('custom_tool')];
    registry.registerFromManifest(manifest, makeMockPromptBuilder(), tools);
    expect(registry.getPromptBuilderForRole('custom_agent')).toBeDefined();

    registry.unregister('custom_agent');
    expect(registry.getPromptBuilderForRole('custom_agent')).toBeUndefined();
  });

  it('should not affect other registered agents', () => {
    const manifest1 = makeValidManifest({ name: 'agent_one' });
    const manifest2 = makeValidManifest({ name: 'agent_two' });
    const tools = [makeMockTool('custom_tool')];
    registry.registerFromManifest(manifest1, makeMockPromptBuilder(), tools);
    registry.registerFromManifest(manifest2, makeMockPromptBuilder(), tools);

    registry.unregister('agent_one');
    expect(registry.getConfig('agent_one')).toBeUndefined();
    expect(registry.getConfig('agent_two')).toBeDefined();
  });

  it('should allow re-registration after unregister', () => {
    const manifest = makeValidManifest();
    const tools = [makeMockTool('custom_tool')];
    registry.registerFromManifest(manifest, makeMockPromptBuilder(), tools);
    registry.unregister('custom_agent');

    const result = registry.registerFromManifest(manifest, makeMockPromptBuilder(), tools);
    expect(isOk(result)).toBe(true);
  });
});

// ─── listRegistered ────────────────────────────────────────────

describe('AgentRegistry — listRegistered', () => {
  beforeEach(() => {
    registry = new AgentRegistry();
  });

  it('should return built-in agents by default', () => {
    const list = registry.listRegistered();
    expect(list.length).toBe(4);
  });

  it('should include dynamically registered agents', () => {
    const manifest = makeValidManifest();
    const tools = [makeMockTool('custom_tool')];
    registry.registerFromManifest(manifest, makeMockPromptBuilder(), tools);

    const list = registry.listRegistered();
    expect(list.length).toBe(5);
    expect(list.some(c => c.displayName === 'custom_agent')).toBe(true);
  });

  it('should not include unregistered agents', () => {
    const manifest = makeValidManifest();
    const tools = [makeMockTool('custom_tool')];
    registry.registerFromManifest(manifest, makeMockPromptBuilder(), tools);
    registry.unregister('custom_agent');

    const list = registry.listRegistered();
    expect(list.length).toBe(4);
    expect(list.some(c => c.displayName === 'custom_agent')).toBe(false);
  });

  it('should return all configs with correct structure', () => {
    const list = registry.listRegistered();
    for (const config of list) {
      expect(config.role).toBeDefined();
      expect(config.displayName).toBeDefined();
      expect(config.description).toBeDefined();
      expect(config.toolAllowlist).toBeDefined();
      expect(config.maxSteps).toBeDefined();
      expect(config.enabled).toBeDefined();
    }
  });
});

// ─── isBuiltIn ─────────────────────────────────────────────────

describe('AgentRegistry — isBuiltIn', () => {
  beforeEach(() => {
    registry = new AgentRegistry();
  });

  it('should return true for collections', () => {
    expect(registry.isBuiltIn('collections')).toBe(true);
  });

  it('should return true for support_triage', () => {
    expect(registry.isBuiltIn('support_triage')).toBe(true);
  });

  it('should return true for escalation', () => {
    expect(registry.isBuiltIn('escalation')).toBe(true);
  });

  it('should return false for custom agents', () => {
    const manifest = makeValidManifest();
    const tools = [makeMockTool('custom_tool')];
    registry.registerFromManifest(manifest, makeMockPromptBuilder(), tools);
    expect(registry.isBuiltIn('custom_agent')).toBe(false);
  });

  it('should return false for unregistered names', () => {
    expect(registry.isBuiltIn('nonexistent')).toBe(false);
  });

  it('should return false for empty string', () => {
    expect(registry.isBuiltIn('')).toBe(false);
  });
});

// ─── Dynamic Agent Behavior ───────────────────────────────────

describe('AgentRegistry — dynamic agent behavior', () => {
  beforeEach(() => {
    registry = new AgentRegistry();
  });

  it('should respect tenant override for dynamic agent', () => {
    const manifest = makeValidManifest();
    const tools = [makeMockTool('custom_tool')];
    registry.registerFromManifest(manifest, makeMockPromptBuilder(), tools);

    registry.setTenantRoleOverride('tenant-1', 'custom_agent', false);
    expect(registry.isRoleEnabled('custom_agent', 'tenant-1')).toBe(false);
    expect(registry.isRoleEnabled('custom_agent', 'tenant-2')).toBe(true);
  });

  it('should filter tools for dynamic agent via getToolsForRole', () => {
    const manifest = makeValidManifest({
      requiredTools: ['custom_tool', 'helper_tool'],
    });
    const tools = [makeMockTool('custom_tool'), makeMockTool('helper_tool')];
    registry.registerFromManifest(manifest, makeMockPromptBuilder(), tools);

    const allTools = new Map<string, AgentTool>();
    allTools.set('custom_tool', makeMockTool('custom_tool'));
    allTools.set('helper_tool', makeMockTool('helper_tool'));
    allTools.set('unrelated_tool', makeMockTool('unrelated_tool'));

    const roleTools = registry.getToolsForRole('custom_agent', allTools);
    expect(roleTools.size).toBe(2);
    expect(roleTools.has('custom_tool')).toBe(true);
    expect(roleTools.has('helper_tool')).toBe(true);
    expect(roleTools.has('unrelated_tool')).toBe(false);
  });

  it('should not expose built-in tools to dynamic agent', () => {
    const manifest = makeValidManifest({ requiredTools: ['custom_tool'] });
    const tools = [makeMockTool('custom_tool')];
    registry.registerFromManifest(manifest, makeMockPromptBuilder(), tools);

    const allTools = new Map<string, AgentTool>();
    allTools.set('custom_tool', makeMockTool('custom_tool'));
    allTools.set('send_sms', makeMockTool('send_sms'));

    const roleTools = registry.getToolsForRole('custom_agent', allTools);
    expect(roleTools.has('send_sms')).toBe(false);
  });
});
