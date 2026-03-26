/**
 * Agent working memory — in-memory state management for agent sessions
 *
 * SECURITY (CLAUDE.md Rules 6, 9):
 * - Memory is session-scoped and never persisted to disk in plaintext
 * - Observations and steps are held in-memory for the agent loop only
 * - summarize() produces metadata-only summaries (no PHI/PII content)
 * - In production, episodic memory migrates to pgvector with encryption
 *
 * COMPLIANCE:
 * - Step history provides the full reasoning chain for WORM audit
 * - Conversation formatting uses role-safe LLMMessage types
 */

import type { LLMMessage } from '@ordr/ai';
import type { AgentStep, AgentMemoryState } from './types.js';

// ─── AgentMemory ────────────────────────────────────────────────

export class AgentMemory {
  private readonly _observations: Map<string, unknown> = new Map();
  private readonly _steps: AgentStep[] = [];

  /**
   * Store an observation from the environment.
   * Overwrites any existing value for the same key.
   */
  addObservation(key: string, value: unknown): void {
    this._observations.set(key, value);
  }

  /**
   * Retrieve an observation by key.
   * Returns undefined if the key has not been set.
   */
  getObservation(key: string): unknown {
    return this._observations.get(key);
  }

  /**
   * Check if an observation exists.
   */
  hasObservation(key: string): boolean {
    return this._observations.has(key);
  }

  /**
   * Get all observation keys.
   */
  getObservationKeys(): readonly string[] {
    return [...this._observations.keys()];
  }

  /**
   * Record a completed step in the agent loop.
   * Steps are append-only — they cannot be modified or removed.
   */
  addStep(step: AgentStep): void {
    this._steps.push(step);
  }

  /**
   * Get the most recent N steps, ordered newest-first.
   */
  getRecentSteps(count: number): readonly AgentStep[] {
    const start = Math.max(0, this._steps.length - count);
    return this._steps.slice(start);
  }

  /**
   * Get total step count.
   */
  get stepCount(): number {
    return this._steps.length;
  }

  /**
   * Get all steps in chronological order.
   */
  getAllSteps(): readonly AgentStep[] {
    return [...this._steps];
  }

  /**
   * Format the step history as an LLM conversation.
   *
   * Each step is converted to a user/assistant message pair:
   * - 'observe' and 'think' steps become user messages (context)
   * - 'act' and 'check' steps become assistant messages (responses)
   *
   * SECURITY: Only metadata is included — no raw PHI/PII content.
   */
  getConversationHistory(): LLMMessage[] {
    const messages: LLMMessage[] = [];

    for (const step of this._steps) {
      if (step.type === 'observe' || step.type === 'think') {
        messages.push({
          role: 'user',
          content: `[${step.type.toUpperCase()}] ${step.output}`,
        });
      } else {
        messages.push({
          role: 'assistant',
          content: `[${step.type.toUpperCase()}]${step.toolUsed !== undefined ? ` Tool: ${step.toolUsed}` : ''} (confidence: ${String(step.confidence)}) ${step.output}`,
        });
      }
    }

    return messages;
  }

  /**
   * Produce a compact summary of the current memory state.
   *
   * SECURITY: Summary contains metadata only — counts, keys, step types.
   * No PHI/PII content is included in the summary string.
   */
  summarize(): string {
    const parts: string[] = [];

    parts.push(`Steps: ${String(this._steps.length)}`);

    if (this._observations.size > 0) {
      parts.push(`Observations: ${[...this._observations.keys()].join(', ')}`);
    }

    const stepsByType = new Map<string, number>();
    for (const step of this._steps) {
      stepsByType.set(step.type, (stepsByType.get(step.type) ?? 0) + 1);
    }

    if (stepsByType.size > 0) {
      const typeCounts = [...stepsByType.entries()]
        .map(([type, count]) => `${type}=${String(count)}`)
        .join(', ');
      parts.push(`Step breakdown: ${typeCounts}`);
    }

    const lastStep = this._steps[this._steps.length - 1];
    if (lastStep !== undefined) {
      parts.push(`Last step: ${lastStep.type} (confidence: ${String(lastStep.confidence)})`);
    }

    return parts.join(' | ');
  }

  /**
   * Export the current state as an immutable snapshot.
   * Used for passing memory state into AgentContext.
   */
  toState(): AgentMemoryState {
    return {
      observations: new Map(this._observations),
      steps: [...this._steps],
    };
  }

  /**
   * Restore memory from a state snapshot.
   */
  static fromState(state: AgentMemoryState): AgentMemory {
    const memory = new AgentMemory();
    for (const [key, value] of state.observations) {
      memory.addObservation(key, value);
    }
    for (const step of state.steps) {
      memory.addStep(step);
    }
    return memory;
  }
}
