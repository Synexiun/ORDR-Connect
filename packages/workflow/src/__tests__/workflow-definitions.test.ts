/**
 * @ordr/workflow — Definition validation, built-in templates, definition store
 *
 * COMPLIANCE (SOC2/ISO27001/HIPAA):
 * - No PHI in test data — only tokenised entity IDs
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  validateDefinition,
  WorkflowDefinitionError,
  InMemoryDefinitionStore,
  createBuiltinDefinitions,
  BUILTIN_TEMPLATES,
  COLLECTIONS_CADENCE_STEPS,
  CUSTOMER_ONBOARDING_STEPS,
  HEALTHCARE_APPOINTMENT_STEPS,
  CHURN_INTERVENTION_STEPS,
  makeActionStep,
  makeDelayStep,
  makeConditionStep,
  makeDefinition,
} from './workflow-helpers.js';
import type { WorkflowStep } from './workflow-helpers.js';

// ─── 1. validateDefinition ──────────────────────────────────────

describe('validateDefinition', () => {
  it('accepts a valid single-step definition', () => {
    expect(() =>
      validateDefinition('My Workflow', [makeActionStep('Step 1')]),
    ).not.toThrow();
  });

  it('accepts a valid multi-step definition', () => {
    expect(() =>
      validateDefinition('Multi Step', [
        makeActionStep('Step 1'),
        makeActionStep('Step 2'),
      ]),
    ).not.toThrow();
  });

  it('throws INVALID_NAME when name is empty string', () => {
    expect(() => validateDefinition('', [makeActionStep('Step 1')])).toThrow(
      WorkflowDefinitionError,
    );
    try {
      validateDefinition('', [makeActionStep('Step 1')]);
    } catch (err) {
      expect(err).toBeInstanceOf(WorkflowDefinitionError);
      expect((err as WorkflowDefinitionError).code).toBe('INVALID_NAME');
    }
  });

  it('throws INVALID_NAME when name is only whitespace', () => {
    expect(() => validateDefinition('   ', [makeActionStep('S')])).toThrow(
      WorkflowDefinitionError,
    );
  });

  it('throws NO_STEPS when steps array is empty', () => {
    try {
      validateDefinition('Valid Name', []);
    } catch (err) {
      expect(err).toBeInstanceOf(WorkflowDefinitionError);
      expect((err as WorkflowDefinitionError).code).toBe('NO_STEPS');
    }
  });

  it('throws INVALID_STEP_NAME when a step has an empty name', () => {
    try {
      validateDefinition('Workflow', [makeActionStep('')]);
    } catch (err) {
      expect(err).toBeInstanceOf(WorkflowDefinitionError);
      expect((err as WorkflowDefinitionError).code).toBe('INVALID_STEP_NAME');
    }
  });

  it('throws INVALID_BRANCH when condition trueBranch is out of bounds', () => {
    const steps: WorkflowStep[] = [
      makeConditionStep('Check', 'variables.x', 'eq', 1, 99, 0),
    ];
    try {
      validateDefinition('Workflow', steps);
    } catch (err) {
      expect(err).toBeInstanceOf(WorkflowDefinitionError);
      expect((err as WorkflowDefinitionError).code).toBe('INVALID_BRANCH');
    }
  });

  it('throws INVALID_BRANCH when condition falseBranch is out of bounds', () => {
    const steps: WorkflowStep[] = [
      makeConditionStep('Check', 'variables.x', 'eq', 1, 0, 99),
    ];
    try {
      validateDefinition('Workflow', steps);
    } catch (err) {
      expect(err).toBeInstanceOf(WorkflowDefinitionError);
      expect((err as WorkflowDefinitionError).code).toBe('INVALID_BRANCH');
    }
  });

  it('throws INVALID_DELAY when delay durationMs is zero', () => {
    const steps: WorkflowStep[] = [makeDelayStep('Wait', 0)];
    try {
      validateDefinition('Workflow', steps);
    } catch (err) {
      expect(err).toBeInstanceOf(WorkflowDefinitionError);
      expect((err as WorkflowDefinitionError).code).toBe('INVALID_DELAY');
    }
  });

  it('throws INVALID_DELAY when delay durationMs is negative', () => {
    const steps: WorkflowStep[] = [makeDelayStep('Wait', -500)];
    try {
      validateDefinition('Workflow', steps);
    } catch (err) {
      expect(err).toBeInstanceOf(WorkflowDefinitionError);
      expect((err as WorkflowDefinitionError).code).toBe('INVALID_DELAY');
    }
  });

  it('accepts a condition step with valid trueBranch and falseBranch', () => {
    const steps: WorkflowStep[] = [
      makeConditionStep('Check', 'variables.status', 'eq', 'paid', 0, 0),
    ];
    expect(() => validateDefinition('Condition Flow', steps)).not.toThrow();
  });
});

// ─── 2. Built-in Templates ──────────────────────────────────────

describe('BUILTIN_TEMPLATES', () => {
  it('has all 4 templates', () => {
    const keys = Object.keys(BUILTIN_TEMPLATES);
    expect(keys).toContain('collections-cadence');
    expect(keys).toContain('customer-onboarding');
    expect(keys).toContain('healthcare-appointment');
    expect(keys).toContain('churn-intervention');
    expect(keys).toHaveLength(4);
  });

  it('collections-cadence has exactly 7 steps', () => {
    expect(COLLECTIONS_CADENCE_STEPS).toHaveLength(7);
  });

  it('customer-onboarding has exactly 5 steps', () => {
    expect(CUSTOMER_ONBOARDING_STEPS).toHaveLength(5);
  });

  it('healthcare-appointment has exactly 4 steps', () => {
    expect(HEALTHCARE_APPOINTMENT_STEPS).toHaveLength(4);
  });

  it('churn-intervention has exactly 3 steps', () => {
    expect(CHURN_INTERVENTION_STEPS).toHaveLength(3);
  });

  it('collections-cadence contains an action, delay, and condition step', () => {
    const types = COLLECTIONS_CADENCE_STEPS.map((s) => s.type);
    expect(types).toContain('action');
    expect(types).toContain('delay');
    expect(types).toContain('condition');
  });

  it('churn-intervention step 2 is human-review type', () => {
    expect(CHURN_INTERVENTION_STEPS[1]?.type).toBe('human-review');
  });

  it('healthcare-appointment steps are all action type', () => {
    const types = HEALTHCARE_APPOINTMENT_STEPS.map((s) => s.type);
    expect(types.every((t) => t === 'action')).toBe(true);
  });

  it('collections-cadence delay steps have businessHoursOnly: true (TCPA)', () => {
    const delaySteps = COLLECTIONS_CADENCE_STEPS.filter((s) => s.type === 'delay');
    for (const step of delaySteps) {
      expect(step.config.type).toBe('delay');
      if (step.config.type === 'delay') {
        expect(step.config.businessHoursOnly).toBe(true);
      }
    }
  });

  it('createBuiltinDefinitions returns 4 definitions for a tenant', () => {
    const defs = createBuiltinDefinitions('tenant-builtin');
    expect(defs).toHaveLength(4);
  });

  it('createBuiltinDefinitions scopes all definitions to the given tenantId', () => {
    const tenantId = 'tenant-abc';
    const defs = createBuiltinDefinitions(tenantId);
    for (const def of defs) {
      expect(def.tenantId).toBe(tenantId);
    }
  });

  it('createBuiltinDefinitions sets isActive true and version 1', () => {
    const defs = createBuiltinDefinitions('tenant-v');
    for (const def of defs) {
      expect(def.isActive).toBe(true);
      expect(def.version).toBe(1);
    }
  });

  it('createBuiltinDefinitions IDs contain the tenant prefix', () => {
    const tenantId = 'tenant-prefix';
    const defs = createBuiltinDefinitions(tenantId);
    for (const def of defs) {
      expect(def.id).toContain(tenantId);
    }
  });
});

// ─── 3. InMemoryDefinitionStore CRUD ────────────────────────────

describe('InMemoryDefinitionStore', () => {
  let store: InMemoryDefinitionStore;

  beforeEach(() => {
    store = new InMemoryDefinitionStore();
  });

  it('creates a definition and retrieves it by ID', async () => {
    const def = await store.create(
      'tenant-1',
      'My Flow',
      'Description',
      [makeActionStep('Step 1')],
      [],
    );
    const fetched = await store.getById('tenant-1', def.id);
    expect(fetched).toBeDefined();
    expect(fetched?.name).toBe('My Flow');
    expect(fetched?.version).toBe(1);
  });

  it('returns undefined for a missing definition', async () => {
    const result = await store.getById('tenant-1', 'nonexistent-id');
    expect(result).toBeUndefined();
  });

  it('lists only definitions for the requesting tenant', async () => {
    await store.create('tenant-A', 'Flow A', '', [makeActionStep('S')], []);
    await store.create('tenant-B', 'Flow B', '', [makeActionStep('S')], []);

    const listA = await store.list('tenant-A');
    expect(listA).toHaveLength(1);
    expect(listA[0]?.name).toBe('Flow A');
  });

  it('updates name and increments version', async () => {
    const def = await store.create('tenant-1', 'Old Name', '', [makeActionStep('S')], []);
    const updated = await store.update('tenant-1', def.id, { name: 'New Name' });
    expect(updated?.name).toBe('New Name');
    expect(updated?.version).toBe(2);
  });

  it('returns undefined when updating a definition belonging to another tenant', async () => {
    const def = await store.create('tenant-A', 'Flow', '', [makeActionStep('S')], []);
    const result = await store.update('tenant-B', def.id, { name: 'Hijack' });
    expect(result).toBeUndefined();
  });

  it('sets isActive to false via update', async () => {
    const def = await store.create('tenant-1', 'Flow', '', [makeActionStep('S')], []);
    const updated = await store.update('tenant-1', def.id, { isActive: false });
    expect(updated?.isActive).toBe(false);
  });

  it('deletes a definition and returns true', async () => {
    const def = await store.create('tenant-1', 'Flow', '', [makeActionStep('S')], []);
    const deleted = await store.delete('tenant-1', def.id);
    expect(deleted).toBe(true);
    const fetched = await store.getById('tenant-1', def.id);
    expect(fetched).toBeUndefined();
  });

  it('returns false when deleting a definition belonging to another tenant', async () => {
    const def = await store.create('tenant-A', 'Flow', '', [makeActionStep('S')], []);
    const result = await store.delete('tenant-B', def.id);
    expect(result).toBe(false);
  });

  it('throws WorkflowDefinitionError when creating with empty name', async () => {
    await expect(
      store.create('tenant-1', '', '', [makeActionStep('S')], []),
    ).rejects.toBeInstanceOf(WorkflowDefinitionError);
  });

  it('seeds definitions directly and retrieves them', async () => {
    const def = makeDefinition('tenant-1', [makeActionStep('S')], { id: 'seed-id' });
    store.seed([def]);
    const fetched = await store.getById('tenant-1', 'seed-id');
    expect(fetched?.id).toBe('seed-id');
  });

  it('clear removes all definitions', async () => {
    await store.create('tenant-1', 'Flow', '', [makeActionStep('S')], []);
    store.clear();
    const list = await store.list('tenant-1');
    expect(list).toHaveLength(0);
  });
});
