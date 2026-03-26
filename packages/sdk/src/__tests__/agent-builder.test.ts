/**
 * Tests for AgentBuilder fluent API
 *
 * COMPLIANCE: Validates Rule 9 (agent safety), Rule 8 (license compliance).
 */

import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { isOk, isErr, ok, ValidationError } from '@ordr/core';
import { AgentBuilder } from '../agent-builder.js';
import type { ToolDefinition, SdkPromptBuilder, SdkDataClassification } from '../types.js';
import type { Regulation } from '@ordr/compliance';

// ─── Helpers ───────────────────────────────────────────────────

function makePromptBuilder(): SdkPromptBuilder {
  return vi.fn().mockReturnValue([
    { role: 'system' as const, content: 'You are a test agent.' },
  ]);
}

function makeTool(name: string = 'test-tool', overrides: Partial<ToolDefinition> = {}): ToolDefinition {
  return {
    name,
    description: `Mock ${name} tool`,
    parameters: z.object({ input: z.string() }),
    dataClassifications: ['internal'],
    regulations: [],
    execute: vi.fn().mockResolvedValue(ok({ status: 'ok' })),
    ...overrides,
  };
}

function makeMinimalBuilder(): AgentBuilder {
  return new AgentBuilder('test-agent')
    .version('1.0.0')
    .description('A test agent')
    .author('test@example.com')
    .license('MIT')
    .withPromptBuilder(makePromptBuilder());
}

// ─── Fluent API Chaining ───────────────────────────────────────

describe('AgentBuilder — fluent API', () => {
  it('should return this from version()', () => {
    const builder = new AgentBuilder('test-agent');
    expect(builder.version('1.0.0')).toBe(builder);
  });

  it('should return this from description()', () => {
    const builder = new AgentBuilder('test-agent');
    expect(builder.description('desc')).toBe(builder);
  });

  it('should return this from author()', () => {
    const builder = new AgentBuilder('test-agent');
    expect(builder.author('author')).toBe(builder);
  });

  it('should return this from license()', () => {
    const builder = new AgentBuilder('test-agent');
    expect(builder.license('MIT')).toBe(builder);
  });

  it('should return this from withTool()', () => {
    const builder = new AgentBuilder('test-agent');
    expect(builder.withTool(makeTool())).toBe(builder);
  });

  it('should return this from requiresCompliance()', () => {
    const builder = new AgentBuilder('test-agent');
    expect(builder.requiresCompliance('hipaa')).toBe(builder);
  });

  it('should return this from withPromptBuilder()', () => {
    const builder = new AgentBuilder('test-agent');
    expect(builder.withPromptBuilder(makePromptBuilder())).toBe(builder);
  });

  it('should return this from entryPoint()', () => {
    const builder = new AgentBuilder('test-agent');
    expect(builder.entryPoint('custom')).toBe(builder);
  });

  it('should return this from confidenceThreshold()', () => {
    const builder = new AgentBuilder('test-agent');
    expect(builder.confidenceThreshold(0.9)).toBe(builder);
  });

  it('should return this from maxBudget()', () => {
    const builder = new AgentBuilder('test-agent');
    expect(builder.maxBudget({ maxTokens: 100, maxCostCents: 10, maxActions: 5 })).toBe(builder);
  });

  it('should support full method chaining', () => {
    const result = new AgentBuilder('chained-agent')
      .version('1.0.0')
      .description('Chained builder test')
      .author('chain@test.com')
      .license('Apache-2.0')
      .withTool(makeTool())
      .requiresCompliance('hipaa')
      .withPromptBuilder(makePromptBuilder())
      .confidenceThreshold(0.85)
      .maxBudget({ maxTokens: 50_000, maxCostCents: 100, maxActions: 20 })
      .build();

    expect(isOk(result)).toBe(true);
  });

  it('should allow calling version() multiple times (last wins)', () => {
    const result = makeMinimalBuilder()
      .version('1.0.0')
      .version('2.0.0')
      .build();

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.manifest.version).toBe('2.0.0');
    }
  });

  it('should allow calling description() multiple times (last wins)', () => {
    const result = makeMinimalBuilder()
      .description('first')
      .description('second')
      .build();

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.manifest.description).toBe('second');
    }
  });

  it('should allow calling license() multiple times (last wins)', () => {
    const result = makeMinimalBuilder()
      .license('MIT')
      .license('Apache-2.0')
      .build();

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.manifest.license).toBe('Apache-2.0');
    }
  });
});

// ─── Build — Success Cases ─────────────────────────────────────

describe('AgentBuilder — build success', () => {
  it('should produce a valid AgentPackage with minimal config', () => {
    const result = makeMinimalBuilder().build();
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.manifest.name).toBe('test-agent');
      expect(result.data.manifest.version).toBe('1.0.0');
    }
  });

  it('should include all tools in the package', () => {
    const tool1 = makeTool('tool-a');
    const tool2 = makeTool('tool-b');
    const result = makeMinimalBuilder()
      .withTool(tool1)
      .withTool(tool2)
      .build();

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.tools).toHaveLength(2);
      expect(result.data.manifest.requiredTools).toContain('tool-a');
      expect(result.data.manifest.requiredTools).toContain('tool-b');
    }
  });

  it('should auto-accumulate data classifications from tools', () => {
    const tool = makeTool('restricted-tool', {
      dataClassifications: ['restricted', 'confidential'],
    });
    const result = makeMinimalBuilder().withTool(tool).build();

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.manifest.permissions).toContain('restricted');
      expect(result.data.manifest.permissions).toContain('confidential');
    }
  });

  it('should auto-accumulate regulations from tools', () => {
    const tool = makeTool('hipaa-tool', {
      regulations: ['hipaa'],
    });
    const result = makeMinimalBuilder().withTool(tool).build();

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.manifest.complianceRequirements).toContain('hipaa');
    }
  });

  it('should merge tool regulations with explicit requirements', () => {
    const tool = makeTool('tcpa-tool', { regulations: ['tcpa'] });
    const result = makeMinimalBuilder()
      .withTool(tool)
      .requiresCompliance('hipaa')
      .build();

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.manifest.complianceRequirements).toContain('hipaa');
      expect(result.data.manifest.complianceRequirements).toContain('tcpa');
    }
  });

  it('should deduplicate regulations', () => {
    const tool = makeTool('hipaa-tool', { regulations: ['hipaa'] });
    const result = makeMinimalBuilder()
      .withTool(tool)
      .requiresCompliance('hipaa', 'hipaa')
      .build();

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      const hipaaCount = result.data.manifest.complianceRequirements.filter(r => r === 'hipaa').length;
      expect(hipaaCount).toBe(1);
    }
  });

  it('should include the prompt builder in the package', () => {
    const promptBuilder = makePromptBuilder();
    const result = makeMinimalBuilder()
      .withPromptBuilder(promptBuilder)
      .build();

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.promptBuilder).toBe(promptBuilder);
    }
  });

  it('should apply default confidence threshold of 0.7', () => {
    const result = makeMinimalBuilder().build();
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.manifest.minConfidenceThreshold).toBe(0.7);
    }
  });

  it('should apply custom confidence threshold', () => {
    const result = makeMinimalBuilder()
      .confidenceThreshold(0.95)
      .build();

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.manifest.minConfidenceThreshold).toBe(0.95);
    }
  });

  it('should apply default budget values', () => {
    const result = makeMinimalBuilder().build();
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.manifest.maxBudget.maxTokens).toBe(50_000);
      expect(result.data.manifest.maxBudget.maxCostCents).toBe(100);
      expect(result.data.manifest.maxBudget.maxActions).toBe(20);
    }
  });

  it('should apply custom budget', () => {
    const result = makeMinimalBuilder()
      .maxBudget({ maxTokens: 100_000, maxCostCents: 500, maxActions: 50 })
      .build();

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.manifest.maxBudget.maxTokens).toBe(100_000);
      expect(result.data.manifest.maxBudget.maxCostCents).toBe(500);
      expect(result.data.manifest.maxBudget.maxActions).toBe(50);
    }
  });

  it('should set the default entry point', () => {
    const result = makeMinimalBuilder().build();
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.manifest.entryPoint).toBe('default');
    }
  });

  it('should accept custom entry point', () => {
    const result = makeMinimalBuilder()
      .entryPoint('customEntry')
      .build();

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.manifest.entryPoint).toBe('customEntry');
    }
  });

  it('should default to MIT license', () => {
    const result = new AgentBuilder('test-agent')
      .version('1.0.0')
      .description('Test')
      .author('test@test.com')
      .withPromptBuilder(makePromptBuilder())
      .build();

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.manifest.license).toBe('MIT');
    }
  });

  it('should accept Apache-2.0 license', () => {
    const result = makeMinimalBuilder().license('Apache-2.0').build();
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.manifest.license).toBe('Apache-2.0');
    }
  });

  it('should accept BSD-3-Clause license', () => {
    const result = makeMinimalBuilder().license('BSD-3-Clause').build();
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.manifest.license).toBe('BSD-3-Clause');
    }
  });

  it('should accept ISC license', () => {
    const result = makeMinimalBuilder().license('ISC').build();
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.manifest.license).toBe('ISC');
    }
  });

  it('should accept MPL-2.0 license', () => {
    const result = makeMinimalBuilder().license('MPL-2.0').build();
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.manifest.license).toBe('MPL-2.0');
    }
  });

  it('should accept confidence threshold exactly at 0.7', () => {
    const result = makeMinimalBuilder().confidenceThreshold(0.7).build();
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.manifest.minConfidenceThreshold).toBe(0.7);
    }
  });

  it('should accept confidence threshold at 1.0', () => {
    const result = makeMinimalBuilder().confidenceThreshold(1.0).build();
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.manifest.minConfidenceThreshold).toBe(1.0);
    }
  });

  it('should accept budget at exact platform limits', () => {
    const result = makeMinimalBuilder()
      .maxBudget({ maxTokens: 1_000_000, maxCostCents: 10_000, maxActions: 500 })
      .build();
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.manifest.maxBudget.maxTokens).toBe(1_000_000);
      expect(result.data.manifest.maxBudget.maxCostCents).toBe(10_000);
      expect(result.data.manifest.maxBudget.maxActions).toBe(500);
    }
  });

  it('should preserve tool order in requiredTools', () => {
    const result = makeMinimalBuilder()
      .withTool(makeTool('alpha'))
      .withTool(makeTool('beta'))
      .withTool(makeTool('gamma'))
      .build();

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.manifest.requiredTools).toEqual(['alpha', 'beta', 'gamma']);
    }
  });

  it('should accept semver with pre-release tag', () => {
    const result = makeMinimalBuilder().version('1.0.0-beta.1').build();
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.manifest.version).toBe('1.0.0-beta.1');
    }
  });

  it('should produce frozen tools array (immutable copy)', () => {
    const tool = makeTool('immutable-tool');
    const result = makeMinimalBuilder().withTool(tool).build();
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.tools).toHaveLength(1);
      expect(result.data.tools[0]?.name).toBe('immutable-tool');
    }
  });
});

// ─── Build — Failure Cases ─────────────────────────────────────

describe('AgentBuilder — build failures', () => {
  it('should fail if prompt builder is not set', () => {
    const result = new AgentBuilder('test-agent')
      .version('1.0.0')
      .description('Test')
      .author('test@test.com')
      .license('MIT')
      .build();

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.message).toContain('Prompt builder');
    }
  });

  it('should fail with invalid name (uppercase)', () => {
    const result = new AgentBuilder('INVALID_NAME')
      .version('1.0.0')
      .description('Test')
      .author('test@test.com')
      .license('MIT')
      .withPromptBuilder(makePromptBuilder())
      .build();

    expect(isErr(result)).toBe(true);
  });

  it('should fail with invalid name (special chars)', () => {
    const result = new AgentBuilder('agent@v1!')
      .version('1.0.0')
      .description('Test')
      .author('test@test.com')
      .withPromptBuilder(makePromptBuilder())
      .build();

    expect(isErr(result)).toBe(true);
  });

  it('should fail with name exceeding 64 chars', () => {
    const longName = 'a' + '-b'.repeat(33);
    const result = new AgentBuilder(longName)
      .version('1.0.0')
      .description('Test')
      .author('test@test.com')
      .withPromptBuilder(makePromptBuilder())
      .build();

    expect(isErr(result)).toBe(true);
  });

  it('should fail with invalid version', () => {
    const result = new AgentBuilder('test-agent')
      .version('not-semver')
      .description('Test')
      .author('test@test.com')
      .withPromptBuilder(makePromptBuilder())
      .build();

    expect(isErr(result)).toBe(true);
  });

  it('should fail with version missing patch', () => {
    const result = makeMinimalBuilder().version('1.0').build();
    expect(isErr(result)).toBe(true);
  });

  it('should fail with non-OSI license', () => {
    const result = makeMinimalBuilder()
      .license('Proprietary')
      .build();

    expect(isErr(result)).toBe(true);
  });

  it('should fail with BUSL-1.1 license', () => {
    const result = makeMinimalBuilder().license('BUSL-1.1').build();
    expect(isErr(result)).toBe(true);
  });

  it('should fail with confidence below 0.7', () => {
    const result = makeMinimalBuilder()
      .confidenceThreshold(0.5)
      .build();

    expect(isErr(result)).toBe(true);
  });

  it('should fail with confidence of 0.69', () => {
    const result = makeMinimalBuilder().confidenceThreshold(0.69).build();
    expect(isErr(result)).toBe(true);
  });

  it('should fail with confidence above 1.0', () => {
    const result = makeMinimalBuilder().confidenceThreshold(1.5).build();
    expect(isErr(result)).toBe(true);
  });

  it('should fail with negative confidence', () => {
    const result = makeMinimalBuilder().confidenceThreshold(-0.1).build();
    expect(isErr(result)).toBe(true);
  });

  it('should fail with excessive token budget', () => {
    const result = makeMinimalBuilder()
      .maxBudget({ maxTokens: 999_999_999, maxCostCents: 100, maxActions: 20 })
      .build();

    expect(isErr(result)).toBe(true);
  });

  it('should fail with excessive cost budget', () => {
    const result = makeMinimalBuilder()
      .maxBudget({ maxTokens: 50_000, maxCostCents: 999_999, maxActions: 20 })
      .build();

    expect(isErr(result)).toBe(true);
  });

  it('should fail with excessive action budget', () => {
    const result = makeMinimalBuilder()
      .maxBudget({ maxTokens: 50_000, maxCostCents: 100, maxActions: 999_999 })
      .build();

    expect(isErr(result)).toBe(true);
  });

  it('should fail with zero token budget', () => {
    const result = makeMinimalBuilder()
      .maxBudget({ maxTokens: 0, maxCostCents: 100, maxActions: 20 })
      .build();

    expect(isErr(result)).toBe(true);
  });

  it('should fail with negative action budget', () => {
    const result = makeMinimalBuilder()
      .maxBudget({ maxTokens: 50_000, maxCostCents: 100, maxActions: -1 })
      .build();

    expect(isErr(result)).toBe(true);
  });

  it('should fail with duplicate tool names', () => {
    const result = makeMinimalBuilder()
      .withTool(makeTool('same-name'))
      .withTool(makeTool('same-name'))
      .build();

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.message).toContain('Tool validation');
    }
  });

  it('should fail with empty tool name', () => {
    const result = makeMinimalBuilder()
      .withTool(makeTool('', { name: '' }))
      .build();

    expect(isErr(result)).toBe(true);
  });

  it('should fail with tool missing description', () => {
    const result = makeMinimalBuilder()
      .withTool(makeTool('no-desc', { description: '' }))
      .build();

    expect(isErr(result)).toBe(true);
  });

  it('should fail with empty description', () => {
    const result = new AgentBuilder('test-agent')
      .version('1.0.0')
      .description('')
      .author('test@test.com')
      .withPromptBuilder(makePromptBuilder())
      .build();

    expect(isErr(result)).toBe(true);
  });

  it('should fail with empty author', () => {
    const result = new AgentBuilder('test-agent')
      .version('1.0.0')
      .description('Test')
      .author('')
      .withPromptBuilder(makePromptBuilder())
      .build();

    expect(isErr(result)).toBe(true);
  });

  it('should return a ValidationError on build failure', () => {
    const result = new AgentBuilder('test-agent')
      .version('1.0.0')
      .description('Test')
      .author('test@test.com')
      .build(); // no prompt builder

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error).toBeInstanceOf(ValidationError);
    }
  });
});

// ─── Data Classifications ──────────────────────────────────────

describe('AgentBuilder — data classification accumulation', () => {
  it('should accumulate public classification from tools', () => {
    const tool = makeTool('public-tool', { dataClassifications: ['public'] });
    const result = makeMinimalBuilder().withTool(tool).build();
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.manifest.permissions).toContain('public');
    }
  });

  it('should accumulate internal classification from tools', () => {
    const tool = makeTool('internal-tool', { dataClassifications: ['internal'] });
    const result = makeMinimalBuilder().withTool(tool).build();
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.manifest.permissions).toContain('internal');
    }
  });

  it('should accumulate confidential classification from tools', () => {
    const tool = makeTool('conf-tool', { dataClassifications: ['confidential'] });
    const result = makeMinimalBuilder().withTool(tool).build();
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.manifest.permissions).toContain('confidential');
    }
  });

  it('should accumulate restricted classification from tools', () => {
    const tool = makeTool('restricted-tool', { dataClassifications: ['restricted'] });
    const result = makeMinimalBuilder().withTool(tool).build();
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.manifest.permissions).toContain('restricted');
    }
  });

  it('should deduplicate classifications from multiple tools', () => {
    const tool1 = makeTool('tool1', { dataClassifications: ['internal', 'confidential'] });
    const tool2 = makeTool('tool2', { dataClassifications: ['internal', 'restricted'] });
    const result = makeMinimalBuilder().withTool(tool1).withTool(tool2).build();

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      const perms = result.data.manifest.permissions;
      const internalCount = perms.filter(p => p === 'internal').length;
      expect(internalCount).toBe(1);
      expect(perms).toContain('confidential');
      expect(perms).toContain('restricted');
    }
  });

  it('should accumulate all four classification levels from multiple tools', () => {
    const tool1 = makeTool('tool-a', { dataClassifications: ['public', 'internal'] });
    const tool2 = makeTool('tool-b', { dataClassifications: ['confidential', 'restricted'] });
    const result = makeMinimalBuilder().withTool(tool1).withTool(tool2).build();

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      const perms = result.data.manifest.permissions;
      expect(perms).toContain('public');
      expect(perms).toContain('internal');
      expect(perms).toContain('confidential');
      expect(perms).toContain('restricted');
    }
  });

  it('should have empty permissions with no tools', () => {
    const result = makeMinimalBuilder().build();
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.manifest.permissions).toHaveLength(0);
    }
  });
});

// ─── Regulation Accumulation ────────────────────────────────────

describe('AgentBuilder — regulation accumulation', () => {
  it('should accumulate hipaa from tool', () => {
    const tool = makeTool('tool', { regulations: ['hipaa'] });
    const result = makeMinimalBuilder().withTool(tool).build();
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.manifest.complianceRequirements).toContain('hipaa');
    }
  });

  it('should accumulate fdcpa from requiresCompliance()', () => {
    const result = makeMinimalBuilder().requiresCompliance('fdcpa').build();
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.manifest.complianceRequirements).toContain('fdcpa');
    }
  });

  it('should accumulate multiple regulations from one tool', () => {
    const tool = makeTool('multi-reg', { regulations: ['hipaa', 'tcpa'] });
    const result = makeMinimalBuilder().withTool(tool).build();
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.manifest.complianceRequirements).toContain('hipaa');
      expect(result.data.manifest.complianceRequirements).toContain('tcpa');
    }
  });

  it('should accumulate regulations from multiple tools', () => {
    const tool1 = makeTool('t1', { regulations: ['hipaa'] });
    const tool2 = makeTool('t2', { regulations: ['gdpr'] });
    const result = makeMinimalBuilder().withTool(tool1).withTool(tool2).build();
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.manifest.complianceRequirements).toContain('hipaa');
      expect(result.data.manifest.complianceRequirements).toContain('gdpr');
    }
  });

  it('should accept multiple regulations via requiresCompliance()', () => {
    const result = makeMinimalBuilder()
      .requiresCompliance('hipaa', 'tcpa', 'gdpr')
      .build();
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.manifest.complianceRequirements).toContain('hipaa');
      expect(result.data.manifest.complianceRequirements).toContain('tcpa');
      expect(result.data.manifest.complianceRequirements).toContain('gdpr');
    }
  });

  it('should have empty regulations when none specified', () => {
    const result = makeMinimalBuilder().build();
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.manifest.complianceRequirements).toHaveLength(0);
    }
  });
});

// ─── Multiple Tools ────────────────────────────────────────────

describe('AgentBuilder — multiple tools', () => {
  it('should handle 0 tools', () => {
    const result = makeMinimalBuilder().build();
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.tools).toHaveLength(0);
    }
  });

  it('should handle 1 tool', () => {
    const result = makeMinimalBuilder().withTool(makeTool('one')).build();
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.tools).toHaveLength(1);
    }
  });

  it('should handle many unique tools', () => {
    let builder = makeMinimalBuilder();
    for (let i = 0; i < 10; i++) {
      builder = builder.withTool(makeTool(`tool-${String(i)}`));
    }
    const result = builder.build();
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.tools).toHaveLength(10);
    }
  });

  it('should reject when 3 tools have same name', () => {
    const result = makeMinimalBuilder()
      .withTool(makeTool('dup'))
      .withTool(makeTool('dup'))
      .withTool(makeTool('dup'))
      .build();

    expect(isErr(result)).toBe(true);
  });

  it('should accept tools with different classifications', () => {
    const publicTool = makeTool('pub', { dataClassifications: ['public'] });
    const restrictedTool = makeTool('restr', { dataClassifications: ['restricted'] });
    const result = makeMinimalBuilder()
      .withTool(publicTool)
      .withTool(restrictedTool)
      .build();

    expect(isOk(result)).toBe(true);
  });

  it('should accept tools with different regulations', () => {
    const hipaaT = makeTool('hipaa-t', { regulations: ['hipaa'] });
    const gdprT = makeTool('gdpr-t', { regulations: ['gdpr'] });
    const result = makeMinimalBuilder()
      .withTool(hipaaT)
      .withTool(gdprT)
      .build();

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.manifest.complianceRequirements).toContain('hipaa');
      expect(result.data.manifest.complianceRequirements).toContain('gdpr');
    }
  });
});
