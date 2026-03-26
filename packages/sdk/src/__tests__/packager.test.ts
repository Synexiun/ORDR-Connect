/**
 * Tests for Agent Packager
 *
 * SECURITY: Validates SHA-256 content hashing and tamper detection.
 * COMPLIANCE: Rule 1 (encryption/hashing), Rule 3 (audit metadata).
 */

import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { isOk, isErr, ok } from '@ordr/core';
import { packageAgent, verifyPackage } from '../packager.js';
import { AgentBuilder } from '../agent-builder.js';
import type { AgentPackage, ToolDefinition, SdkPromptBuilder } from '../types.js';

// ─── Helpers ───────────────────────────────────────────────────

function makePromptBuilder(): SdkPromptBuilder {
  return vi.fn().mockReturnValue([
    { role: 'system' as const, content: 'Test agent prompt' },
  ]);
}

function makeTool(name: string): ToolDefinition {
  return {
    name,
    description: `Mock ${name} tool`,
    parameters: z.object({}),
    dataClassifications: ['internal'],
    regulations: [],
    execute: vi.fn().mockResolvedValue(ok({ status: 'ok' })),
  };
}

function makeValidAgent(tools: string[] = ['test-tool']): AgentPackage {
  let builder = new AgentBuilder('packager-test')
    .version('1.0.0')
    .description('Agent for packager tests')
    .author('test@example.com')
    .license('MIT')
    .withPromptBuilder(makePromptBuilder());

  for (const toolName of tools) {
    builder = builder.withTool(makeTool(toolName));
  }

  const result = builder.build();
  if (!isOk(result)) {
    throw new Error('Failed to build test agent');
  }
  return result.data;
}

// ─── Package ───────────────────────────────────────────────────

describe('packageAgent', () => {
  it('should produce a valid packaged agent', () => {
    const agent = makeValidAgent();
    const result = packageAgent(agent);
    expect(isOk(result)).toBe(true);
  });

  it('should include the manifest in the package', () => {
    const agent = makeValidAgent();
    const result = packageAgent(agent);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.manifest.name).toBe('packager-test');
    }
  });

  it('should generate a SHA-256 content hash', () => {
    const agent = makeValidAgent();
    const result = packageAgent(agent);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.contentHash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('should produce deterministic hashes for same content', () => {
    const agent = makeValidAgent();
    const result1 = packageAgent(agent);
    const result2 = packageAgent(agent);
    expect(isOk(result1)).toBe(true);
    expect(isOk(result2)).toBe(true);
    if (isOk(result1) && isOk(result2)) {
      expect(result1.data.contentHash).toBe(result2.data.contentHash);
    }
  });

  it('should produce different hashes for different content', () => {
    const agent1 = makeValidAgent(['tool-a']);
    const agent2 = makeValidAgent(['tool-b']);
    const result1 = packageAgent(agent1);
    const result2 = packageAgent(agent2);
    expect(isOk(result1)).toBe(true);
    expect(isOk(result2)).toBe(true);
    if (isOk(result1) && isOk(result2)) {
      expect(result1.data.contentHash).not.toBe(result2.data.contentHash);
    }
  });

  it('should include signature field (placeholder)', () => {
    const agent = makeValidAgent();
    const result = packageAgent(agent);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(typeof result.data.signature).toBe('string');
    }
  });

  it('should include createdAt timestamp', () => {
    const agent = makeValidAgent();
    const result = packageAgent(agent);
    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.createdAt).toBeInstanceOf(Date);
    }
  });

  it('should set createdAt to approximately now', () => {
    const before = new Date();
    const agent = makeValidAgent();
    const result = packageAgent(agent);
    const after = new Date();

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.data.createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(result.data.createdAt.getTime()).toBeLessThanOrEqual(after.getTime());
    }
  });

  it('should package agent with no tools when manifest declares none', () => {
    const agent = new AgentBuilder('no-tools')
      .version('1.0.0')
      .description('Agent with no tools')
      .author('test@test.com')
      .license('MIT')
      .withPromptBuilder(makePromptBuilder())
      .build();

    expect(isOk(agent)).toBe(true);
    if (!isOk(agent)) return;

    const result = packageAgent(agent.data);
    expect(isOk(result)).toBe(true);
  });

  it('should fail when required tools are missing from definitions', () => {
    // Manually craft an agent with mismatched tools
    const agent: AgentPackage = {
      manifest: {
        name: 'mismatch-agent',
        version: '1.0.0',
        description: 'Agent with missing tool defs',
        author: 'test@test.com',
        license: 'MIT',
        requiredTools: ['tool-a', 'tool-b'],
        complianceRequirements: [],
        permissions: [],
        entryPoint: 'default',
        minConfidenceThreshold: 0.8,
        maxBudget: { maxTokens: 50_000, maxCostCents: 100, maxActions: 20 },
      },
      promptBuilder: makePromptBuilder(),
      tools: [makeTool('tool-a')], // tool-b is missing
    };

    const result = packageAgent(agent);
    expect(isErr(result)).toBe(true);
  });
});

// ─── Verify ────────────────────────────────────────────────────

describe('verifyPackage', () => {
  it('should verify a valid package', () => {
    const agent = makeValidAgent();
    const pkgResult = packageAgent(agent);
    expect(isOk(pkgResult)).toBe(true);
    if (!isOk(pkgResult)) return;

    const verifyResult = verifyPackage(pkgResult.data, agent);
    expect(isOk(verifyResult)).toBe(true);
  });

  it('should detect tampered manifest name', () => {
    const agent = makeValidAgent();
    const pkgResult = packageAgent(agent);
    expect(isOk(pkgResult)).toBe(true);
    if (!isOk(pkgResult)) return;

    // Tamper with the original agent (simulate different content)
    const tamperedAgent: AgentPackage = {
      ...agent,
      manifest: { ...agent.manifest, description: 'Tampered description!!!' },
    };

    const verifyResult = verifyPackage(pkgResult.data, tamperedAgent);
    expect(isErr(verifyResult)).toBe(true);
  });

  it('should detect tampered tool list', () => {
    const agent = makeValidAgent(['tool-a']);
    const pkgResult = packageAgent(agent);
    expect(isOk(pkgResult)).toBe(true);
    if (!isOk(pkgResult)) return;

    // Create a different agent with different tools
    const differentAgent = makeValidAgent(['tool-b']);

    const verifyResult = verifyPackage(pkgResult.data, differentAgent);
    expect(isErr(verifyResult)).toBe(true);
  });

  it('should pass round-trip: package -> verify', () => {
    const agent = makeValidAgent(['tool-x', 'tool-y']);
    const pkgResult = packageAgent(agent);
    expect(isOk(pkgResult)).toBe(true);
    if (!isOk(pkgResult)) return;

    const verifyResult = verifyPackage(pkgResult.data, agent);
    expect(isOk(verifyResult)).toBe(true);
  });

  it('should detect hash mismatch with explicit wrong hash', () => {
    const agent = makeValidAgent();
    const pkgResult = packageAgent(agent);
    expect(isOk(pkgResult)).toBe(true);
    if (!isOk(pkgResult)) return;

    // Create a package with wrong hash
    const tampered = {
      ...pkgResult.data,
      contentHash: 'aaaa' + 'bbbb'.repeat(7),
    };

    const verifyResult = verifyPackage(tampered, agent);
    expect(isErr(verifyResult)).toBe(true);
  });

  it('should verify package created with multiple tools', () => {
    const agent = makeValidAgent(['t1', 't2', 't3']);
    const pkgResult = packageAgent(agent);
    expect(isOk(pkgResult)).toBe(true);
    if (!isOk(pkgResult)) return;

    const verifyResult = verifyPackage(pkgResult.data, agent);
    expect(isOk(verifyResult)).toBe(true);
  });

  it('should handle verification of zero-tool agents', () => {
    const agentResult = new AgentBuilder('zero-tools')
      .version('1.0.0')
      .description('No tools agent')
      .author('test@test.com')
      .license('MIT')
      .withPromptBuilder(makePromptBuilder())
      .build();

    expect(isOk(agentResult)).toBe(true);
    if (!isOk(agentResult)) return;

    const pkgResult = packageAgent(agentResult.data);
    expect(isOk(pkgResult)).toBe(true);
    if (!isOk(pkgResult)) return;

    const verifyResult = verifyPackage(pkgResult.data, agentResult.data);
    expect(isOk(verifyResult)).toBe(true);
  });

  it('should return content hash as 64-char hex string', () => {
    const agent = makeValidAgent();
    const pkgResult = packageAgent(agent);
    expect(isOk(pkgResult)).toBe(true);
    if (!isOk(pkgResult)) return;
    expect(pkgResult.data.contentHash).toHaveLength(64);
    expect(pkgResult.data.contentHash).toMatch(/^[0-9a-f]+$/);
  });

  it('should preserve manifest through packaging', () => {
    const agent = makeValidAgent();
    const pkgResult = packageAgent(agent);
    expect(isOk(pkgResult)).toBe(true);
    if (!isOk(pkgResult)) return;
    expect(pkgResult.data.manifest).toEqual(agent.manifest);
  });
});
