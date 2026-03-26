import { describe, it, expect } from 'vitest';
import {
  HEALTHCARE_NODE_TYPES,
  HEALTHCARE_EDGE_TYPES,
  patientNodeSchema,
  providerNodeSchema,
  appointmentNodeSchema,
  carePlanNodeSchema,
} from '../healthcare-nodes.js';
import type {
  HealthcareNodeType,
  HealthcareEdgeType,
  PatientNode,
  ProviderNode,
  AppointmentNode,
  CarePlanNode,
  TreatedByRelationship,
  HasAppointmentRelationship,
  FollowsPlanRelationship,
  ReferredToRelationship,
} from '../healthcare-nodes.js';

// ─── Node Type Constants ────────────────────────────────────────

describe('Healthcare Node Types', () => {
  it('should define 4 healthcare node types', () => {
    expect(HEALTHCARE_NODE_TYPES).toHaveLength(4);
  });

  it('should include Patient type', () => {
    expect(HEALTHCARE_NODE_TYPES).toContain('Patient');
  });

  it('should include Provider type', () => {
    expect(HEALTHCARE_NODE_TYPES).toContain('Provider');
  });

  it('should include Appointment type', () => {
    expect(HEALTHCARE_NODE_TYPES).toContain('Appointment');
  });

  it('should include CarePlan type', () => {
    expect(HEALTHCARE_NODE_TYPES).toContain('CarePlan');
  });
});

// ─── Edge Type Constants ────────────────────────────────────────

describe('Healthcare Edge Types', () => {
  it('should define 4 healthcare edge types', () => {
    expect(HEALTHCARE_EDGE_TYPES).toHaveLength(4);
  });

  it('should include TREATED_BY', () => {
    expect(HEALTHCARE_EDGE_TYPES).toContain('TREATED_BY');
  });

  it('should include HAS_APPOINTMENT', () => {
    expect(HEALTHCARE_EDGE_TYPES).toContain('HAS_APPOINTMENT');
  });

  it('should include FOLLOWS_PLAN', () => {
    expect(HEALTHCARE_EDGE_TYPES).toContain('FOLLOWS_PLAN');
  });

  it('should include REFERRED_TO', () => {
    expect(HEALTHCARE_EDGE_TYPES).toContain('REFERRED_TO');
  });
});

// ─── Patient Node Schema ────────────────────────────────────────

describe('patientNodeSchema', () => {
  it('should validate a correct patient node (tokenized, no PHI)', () => {
    const result = patientNodeSchema.safeParse({
      type: 'Patient',
      tenantId: 'tenant-health',
      patientToken: 'pat-token-abc123',
      status: 'active',
      riskLevel: 'low',
      consentStatus: 'granted',
    });
    expect(result.success).toBe(true);
  });

  it('should reject empty tenantId', () => {
    const result = patientNodeSchema.safeParse({
      type: 'Patient',
      tenantId: '',
      patientToken: 'pat-token-abc123',
      status: 'active',
      riskLevel: 'low',
      consentStatus: 'granted',
    });
    expect(result.success).toBe(false);
  });

  it('should reject empty patientToken', () => {
    const result = patientNodeSchema.safeParse({
      type: 'Patient',
      tenantId: 'tenant-health',
      patientToken: '',
      status: 'active',
      riskLevel: 'low',
      consentStatus: 'granted',
    });
    expect(result.success).toBe(false);
  });

  it('should reject invalid status', () => {
    const result = patientNodeSchema.safeParse({
      type: 'Patient',
      tenantId: 'tenant-health',
      patientToken: 'pat-token-abc123',
      status: 'unknown',
      riskLevel: 'low',
      consentStatus: 'granted',
    });
    expect(result.success).toBe(false);
  });

  it('should accept all valid statuses', () => {
    for (const status of ['active', 'inactive', 'discharged']) {
      const result = patientNodeSchema.safeParse({
        type: 'Patient',
        tenantId: 'tenant-health',
        patientToken: 'pat-token-abc123',
        status,
        riskLevel: 'low',
        consentStatus: 'granted',
      });
      expect(result.success).toBe(true);
    }
  });

  it('should accept all valid risk levels', () => {
    for (const riskLevel of ['low', 'medium', 'high']) {
      const result = patientNodeSchema.safeParse({
        type: 'Patient',
        tenantId: 'tenant-health',
        patientToken: 'pat-token-abc123',
        status: 'active',
        riskLevel,
        consentStatus: 'granted',
      });
      expect(result.success).toBe(true);
    }
  });

  it('should accept all valid consent statuses', () => {
    for (const consentStatus of ['granted', 'revoked', 'pending']) {
      const result = patientNodeSchema.safeParse({
        type: 'Patient',
        tenantId: 'tenant-health',
        patientToken: 'pat-token-abc123',
        status: 'active',
        riskLevel: 'low',
        consentStatus,
      });
      expect(result.success).toBe(true);
    }
  });

  it('should reject wrong node type', () => {
    const result = patientNodeSchema.safeParse({
      type: 'Provider',
      tenantId: 'tenant-health',
      patientToken: 'pat-token-abc123',
      status: 'active',
      riskLevel: 'low',
      consentStatus: 'granted',
    });
    expect(result.success).toBe(false);
  });
});

// ─── Provider Node Schema ───────────────────────────────────────

describe('providerNodeSchema', () => {
  it('should validate a correct provider node', () => {
    const result = providerNodeSchema.safeParse({
      type: 'Provider',
      tenantId: 'tenant-health',
      name: 'Dr. Jane Smith',
      specialty: 'Cardiology',
      npiNumber: '1234567890',
      status: 'active',
    });
    expect(result.success).toBe(true);
  });

  it('should reject invalid NPI (too short)', () => {
    const result = providerNodeSchema.safeParse({
      type: 'Provider',
      tenantId: 'tenant-health',
      name: 'Dr. Smith',
      specialty: 'Cardiology',
      npiNumber: '12345',
      status: 'active',
    });
    expect(result.success).toBe(false);
  });

  it('should reject invalid NPI (non-numeric)', () => {
    const result = providerNodeSchema.safeParse({
      type: 'Provider',
      tenantId: 'tenant-health',
      name: 'Dr. Smith',
      specialty: 'Cardiology',
      npiNumber: 'abcdefghij',
      status: 'active',
    });
    expect(result.success).toBe(false);
  });

  it('should reject empty name', () => {
    const result = providerNodeSchema.safeParse({
      type: 'Provider',
      tenantId: 'tenant-health',
      name: '',
      specialty: 'Cardiology',
      npiNumber: '1234567890',
      status: 'active',
    });
    expect(result.success).toBe(false);
  });

  it('should reject empty specialty', () => {
    const result = providerNodeSchema.safeParse({
      type: 'Provider',
      tenantId: 'tenant-health',
      name: 'Dr. Smith',
      specialty: '',
      npiNumber: '1234567890',
      status: 'active',
    });
    expect(result.success).toBe(false);
  });

  it('should accept all valid statuses', () => {
    for (const status of ['active', 'inactive']) {
      const result = providerNodeSchema.safeParse({
        type: 'Provider',
        tenantId: 'tenant-health',
        name: 'Dr. Smith',
        specialty: 'Cardiology',
        npiNumber: '1234567890',
        status,
      });
      expect(result.success).toBe(true);
    }
  });
});

// ─── Appointment Node Schema ────────────────────────────────────

describe('appointmentNodeSchema', () => {
  it('should validate a correct appointment node', () => {
    const result = appointmentNodeSchema.safeParse({
      type: 'Appointment',
      tenantId: 'tenant-health',
      appointmentDate: '2026-04-15T10:00:00Z',
      appointmentType: 'follow_up',
      status: 'scheduled',
    });
    expect(result.success).toBe(true);
  });

  it('should reject invalid date string', () => {
    const result = appointmentNodeSchema.safeParse({
      type: 'Appointment',
      tenantId: 'tenant-health',
      appointmentDate: 'not-a-date',
      appointmentType: 'follow_up',
      status: 'scheduled',
    });
    expect(result.success).toBe(false);
  });

  it('should accept all valid statuses', () => {
    for (const status of ['scheduled', 'confirmed', 'completed', 'cancelled', 'no_show']) {
      const result = appointmentNodeSchema.safeParse({
        type: 'Appointment',
        tenantId: 'tenant-health',
        appointmentDate: '2026-04-15T10:00:00Z',
        appointmentType: 'checkup',
        status,
      });
      expect(result.success).toBe(true);
    }
  });

  it('should reject empty appointmentType', () => {
    const result = appointmentNodeSchema.safeParse({
      type: 'Appointment',
      tenantId: 'tenant-health',
      appointmentDate: '2026-04-15T10:00:00Z',
      appointmentType: '',
      status: 'scheduled',
    });
    expect(result.success).toBe(false);
  });
});

// ─── CarePlan Node Schema ───────────────────────────────────────

describe('carePlanNodeSchema', () => {
  it('should validate a correct care plan node', () => {
    const result = carePlanNodeSchema.safeParse({
      type: 'CarePlan',
      tenantId: 'tenant-health',
      status: 'active',
      goalCount: 5,
    });
    expect(result.success).toBe(true);
  });

  it('should accept all valid statuses', () => {
    for (const status of ['active', 'completed', 'suspended', 'draft']) {
      const result = carePlanNodeSchema.safeParse({
        type: 'CarePlan',
        tenantId: 'tenant-health',
        status,
        goalCount: 3,
      });
      expect(result.success).toBe(true);
    }
  });

  it('should reject negative goalCount', () => {
    const result = carePlanNodeSchema.safeParse({
      type: 'CarePlan',
      tenantId: 'tenant-health',
      status: 'active',
      goalCount: -1,
    });
    expect(result.success).toBe(false);
  });

  it('should accept zero goalCount', () => {
    const result = carePlanNodeSchema.safeParse({
      type: 'CarePlan',
      tenantId: 'tenant-health',
      status: 'draft',
      goalCount: 0,
    });
    expect(result.success).toBe(true);
  });

  it('should reject non-integer goalCount', () => {
    const result = carePlanNodeSchema.safeParse({
      type: 'CarePlan',
      tenantId: 'tenant-health',
      status: 'active',
      goalCount: 3.5,
    });
    expect(result.success).toBe(false);
  });
});

// ─── Type Safety (compile-time guarantees) ──────────────────────

describe('Type interfaces', () => {
  it('PatientNode uses tokenized reference (no raw PHI)', () => {
    const node: PatientNode = {
      id: 'node-1',
      type: 'Patient',
      tenantId: 'tenant-1',
      patientToken: 'tok-abc',
      status: 'active',
      riskLevel: 'low',
      consentStatus: 'granted',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    // Verify token is used instead of name/SSN/DOB
    expect(node.patientToken).toBeDefined();
    expect((node as Record<string, unknown>)['name']).toBeUndefined();
    expect((node as Record<string, unknown>)['ssn']).toBeUndefined();
    expect((node as Record<string, unknown>)['dateOfBirth']).toBeUndefined();
  });

  it('ProviderNode stores professional info', () => {
    const node: ProviderNode = {
      id: 'node-2',
      type: 'Provider',
      tenantId: 'tenant-1',
      name: 'Dr. Smith',
      specialty: 'Cardiology',
      npiNumber: '1234567890',
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    expect(node.npiNumber).toHaveLength(10);
  });

  it('AppointmentNode has no patient PHI', () => {
    const node: AppointmentNode = {
      id: 'node-3',
      type: 'Appointment',
      tenantId: 'tenant-1',
      appointmentDate: '2026-04-15T10:00:00Z',
      appointmentType: 'follow_up',
      status: 'scheduled',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    expect((node as Record<string, unknown>)['patientName']).toBeUndefined();
    expect((node as Record<string, unknown>)['diagnosis']).toBeUndefined();
  });

  it('CarePlanNode contains metadata only', () => {
    const node: CarePlanNode = {
      id: 'node-4',
      type: 'CarePlan',
      tenantId: 'tenant-1',
      status: 'active',
      goalCount: 5,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    expect((node as Record<string, unknown>)['clinicalNotes']).toBeUndefined();
    expect((node as Record<string, unknown>)['medications']).toBeUndefined();
  });

  it('TreatedByRelationship links Patient to Provider', () => {
    const rel: TreatedByRelationship = {
      type: 'TREATED_BY',
      sourceId: 'patient-node-1',
      targetId: 'provider-node-1',
      tenantId: 'tenant-1',
      since: '2026-01-01',
      isPrimary: true,
    };
    expect(rel.type).toBe('TREATED_BY');
    expect(rel.isPrimary).toBe(true);
  });

  it('HasAppointmentRelationship links Patient to Appointment', () => {
    const rel: HasAppointmentRelationship = {
      type: 'HAS_APPOINTMENT',
      sourceId: 'patient-node-1',
      targetId: 'appointment-node-1',
      tenantId: 'tenant-1',
    };
    expect(rel.type).toBe('HAS_APPOINTMENT');
  });

  it('FollowsPlanRelationship links Patient to CarePlan', () => {
    const rel: FollowsPlanRelationship = {
      type: 'FOLLOWS_PLAN',
      sourceId: 'patient-node-1',
      targetId: 'careplan-node-1',
      tenantId: 'tenant-1',
      enrolledDate: '2026-01-15',
    };
    expect(rel.type).toBe('FOLLOWS_PLAN');
  });

  it('ReferredToRelationship links Provider to Provider', () => {
    const rel: ReferredToRelationship = {
      type: 'REFERRED_TO',
      sourceId: 'provider-node-1',
      targetId: 'provider-node-2',
      tenantId: 'tenant-1',
      referralDate: '2026-03-01',
      reason: 'Specialist consultation needed',
    };
    expect(rel.type).toBe('REFERRED_TO');
    expect(rel.reason).toBeDefined();
  });
});
