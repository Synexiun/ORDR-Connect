/**
 * AgentBuilder — Fluent API for constructing SDK agent packages
 *
 * SECURITY (CLAUDE.md Rule 9):
 * - build() validates the complete manifest before producing a package
 * - All tools are checked for valid definitions
 * - Confidence threshold and budget caps are enforced at build time
 *
 * COMPLIANCE:
 * - License compliance checked via OSI-approved list (Rule 8)
 * - Regulatory requirements accumulated and validated (Rule 9)
 * - Tool data classifications captured for runtime enforcement
 */

import { ok, err, ValidationError } from '@ordr/core';
import type { Result } from '@ordr/core';
import type { AppError } from '@ordr/core';
import type { Regulation } from '@ordr/compliance';
import type {
  AgentManifest,
  AgentPackage,
  ToolDefinition,
  SdkPromptBuilder,
  AgentBudgetConfig,
  SdkDataClassification,
} from './types.js';
import { validateManifest } from './manifest-validator.js';

// ─── AgentBuilder ──────────────────────────────────────────────

export class AgentBuilder {
  private readonly _name: string;
  private _version: string = '0.0.1';
  private _description: string = '';
  private _author: string = '';
  private _license: string = 'MIT';
  private readonly _tools: ToolDefinition[] = [];
  private readonly _complianceRequirements: Set<Regulation> = new Set();
  private readonly _permissions: Set<SdkDataClassification> = new Set();
  private _promptBuilder: SdkPromptBuilder | undefined = undefined;
  private _entryPoint: string = 'default';
  private _confidenceThreshold: number = 0.7;
  private _budget: AgentBudgetConfig = {
    maxTokens: 50_000,
    maxCostCents: 100,
    maxActions: 20,
  };

  constructor(name: string) {
    this._name = name;
  }

  /**
   * Set the agent version (semver).
   */
  version(version: string): this {
    this._version = version;
    return this;
  }

  /**
   * Set the agent description.
   */
  description(description: string): this {
    this._description = description;
    return this;
  }

  /**
   * Set the agent author.
   */
  author(author: string): this {
    this._author = author;
    return this;
  }

  /**
   * Set the agent license (must be OSI-approved).
   */
  license(license: string): this {
    this._license = license;
    return this;
  }

  /**
   * Add a tool to the agent's allowlist.
   */
  withTool(tool: ToolDefinition): this {
    this._tools.push(tool);

    // Auto-accumulate data classifications from tools
    for (const classification of tool.dataClassifications) {
      this._permissions.add(classification);
    }

    // Auto-accumulate regulations from tools
    for (const regulation of tool.regulations) {
      this._complianceRequirements.add(regulation);
    }

    return this;
  }

  /**
   * Declare compliance requirements.
   * Accepts one or more regulation identifiers.
   */
  requiresCompliance(...regulations: readonly Regulation[]): this {
    for (const reg of regulations) {
      this._complianceRequirements.add(reg);
    }
    return this;
  }

  /**
   * Set the prompt builder function.
   */
  withPromptBuilder(builder: SdkPromptBuilder): this {
    this._promptBuilder = builder;
    return this;
  }

  /**
   * Set the entry point name.
   */
  entryPoint(entryPoint: string): this {
    this._entryPoint = entryPoint;
    return this;
  }

  /**
   * Set the minimum confidence threshold (>= 0.7).
   */
  confidenceThreshold(threshold: number): this {
    this._confidenceThreshold = threshold;
    return this;
  }

  /**
   * Set the maximum budget for agent execution.
   */
  maxBudget(budget: AgentBudgetConfig): this {
    this._budget = budget;
    return this;
  }

  /**
   * Build the agent package.
   * Validates the manifest, checks all tools, returns Result.
   */
  build(): Result<AgentPackage, AppError> {
    // Check prompt builder is set
    if (this._promptBuilder === undefined) {
      return err(new ValidationError(
        'Prompt builder is required',
        { promptBuilder: ['Prompt builder must be set via withPromptBuilder()'] },
      ));
    }

    // Assemble the manifest
    const manifestData: AgentManifest = {
      name: this._name,
      version: this._version,
      description: this._description,
      author: this._author,
      license: this._license,
      requiredTools: this._tools.map(t => t.name),
      complianceRequirements: [...this._complianceRequirements],
      permissions: [...this._permissions],
      entryPoint: this._entryPoint,
      minConfidenceThreshold: this._confidenceThreshold,
      maxBudget: this._budget,
    };

    // Validate manifest
    const validationResult = validateManifest(manifestData);
    if (!validationResult.success) {
      return validationResult;
    }

    // Validate tool definitions
    const toolErrors: string[] = [];
    const toolNames = new Set<string>();

    for (const tool of this._tools) {
      // Check for duplicate tool names
      if (toolNames.has(tool.name)) {
        toolErrors.push(`Duplicate tool name: ${tool.name}`);
      }
      toolNames.add(tool.name);

      // Check tool has a name
      if (tool.name.length === 0) {
        toolErrors.push('Tool name cannot be empty');
      }

      // Check tool has a description
      if (tool.description.length === 0) {
        toolErrors.push(`Tool "${tool.name}" has no description`);
      }

      // Check tool has an execute function
      if (typeof tool.execute !== 'function') {
        toolErrors.push(`Tool "${tool.name}" has no execute function`);
      }
    }

    if (toolErrors.length > 0) {
      return err(new ValidationError(
        'Tool validation failed',
        { tools: toolErrors },
      ));
    }

    const pkg: AgentPackage = {
      manifest: validationResult.data,
      promptBuilder: this._promptBuilder,
      tools: [...this._tools],
    };

    return ok(pkg);
  }
}
