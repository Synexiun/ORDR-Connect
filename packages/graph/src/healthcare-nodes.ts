/**
 * Healthcare graph node types — Neo4j node/edge definitions for healthcare vertical
 *
 * SECURITY (CLAUDE.md Rules 1, 6):
 * - Patient nodes store ONLY tokenized references — never raw PHI
 * - No names, SSNs, dates of birth, diagnoses, or other PHI in graph
 * - All nodes are tenant-scoped by design
 * - Graph queries enforce tenant isolation
 *
 * COMPLIANCE:
 * - HIPAA §164.502(b) — minimum necessary in graph storage
 * - HIPAA §164.312(a)(2)(iv) — no PHI in graph (stored encrypted elsewhere)
 * - SOC2 CC6.1 — tenant-scoped access controls
 * - ISO 27001 A.8.2 — data classification enforced
 */

import { z } from 'zod';

// ─── Healthcare Node Types ──────────────────────────────────────

export const HEALTHCARE_NODE_TYPES = [
  'Patient',
  'Provider',
  'Appointment',
  'CarePlan',
] as const;

export type HealthcareNodeType = (typeof HEALTHCARE_NODE_TYPES)[number];

// ─── Healthcare Edge Types ──────────────────────────────────────

export const HEALTHCARE_EDGE_TYPES = [
  'TREATED_BY',
  'HAS_APPOINTMENT',
  'FOLLOWS_PLAN',
  'REFERRED_TO',
] as const;

export type HealthcareEdgeType = (typeof HEALTHCARE_EDGE_TYPES)[number];

// ─── Node Interfaces ────────────────────────────────────────────

/**
 * Patient node — tokenized reference only, NO raw PHI.
 * All identifiable data is stored encrypted in PostgreSQL,
 * referenced here by opaque token.
 */
export interface PatientNode {
  readonly id: string;
  readonly type: 'Patient';
  readonly tenantId: string;
  readonly patientToken: string;
  readonly status: 'active' | 'inactive' | 'discharged';
  readonly riskLevel: 'low' | 'medium' | 'high';
  readonly consentStatus: 'granted' | 'revoked' | 'pending';
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Provider node — healthcare provider details.
 * Contains professional information (not PHI).
 */
export interface ProviderNode {
  readonly id: string;
  readonly type: 'Provider';
  readonly tenantId: string;
  readonly name: string;
  readonly specialty: string;
  readonly npiNumber: string;
  readonly status: 'active' | 'inactive';
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Appointment node — scheduling record.
 * References patient by token, not PHI.
 */
export interface AppointmentNode {
  readonly id: string;
  readonly type: 'Appointment';
  readonly tenantId: string;
  readonly appointmentDate: string;
  readonly appointmentType: string;
  readonly status: 'scheduled' | 'confirmed' | 'completed' | 'cancelled' | 'no_show';
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * CarePlan node — care plan metadata.
 * No clinical details — those are encrypted in PostgreSQL.
 */
export interface CarePlanNode {
  readonly id: string;
  readonly type: 'CarePlan';
  readonly tenantId: string;
  readonly status: 'active' | 'completed' | 'suspended' | 'draft';
  readonly goalCount: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

// ─── Zod Schemas ────────────────────────────────────────────────

export const patientNodeSchema = z.object({
  type: z.literal('Patient'),
  tenantId: z.string().min(1),
  patientToken: z.string().min(1),
  status: z.enum(['active', 'inactive', 'discharged']),
  riskLevel: z.enum(['low', 'medium', 'high']),
  consentStatus: z.enum(['granted', 'revoked', 'pending']),
});

export const providerNodeSchema = z.object({
  type: z.literal('Provider'),
  tenantId: z.string().min(1),
  name: z.string().min(1),
  specialty: z.string().min(1),
  npiNumber: z.string().regex(/^\d{10}$/, 'NPI must be exactly 10 digits'),
  status: z.enum(['active', 'inactive']),
});

export const appointmentNodeSchema = z.object({
  type: z.literal('Appointment'),
  tenantId: z.string().min(1),
  appointmentDate: z.string().refine(
    (val) => !isNaN(Date.parse(val)),
    'Must be a valid ISO 8601 date string',
  ),
  appointmentType: z.string().min(1),
  status: z.enum(['scheduled', 'confirmed', 'completed', 'cancelled', 'no_show']),
});

export const carePlanNodeSchema = z.object({
  type: z.literal('CarePlan'),
  tenantId: z.string().min(1),
  status: z.enum(['active', 'completed', 'suspended', 'draft']),
  goalCount: z.number().int().min(0),
});

// ─── Relationship Definitions ───────────────────────────────────

/**
 * TREATED_BY: Patient -> Provider
 * Indicates an active treatment relationship.
 */
export interface TreatedByRelationship {
  readonly type: 'TREATED_BY';
  readonly sourceId: string;  // Patient node ID
  readonly targetId: string;  // Provider node ID
  readonly tenantId: string;
  readonly since: string;
  readonly isPrimary: boolean;
}

/**
 * HAS_APPOINTMENT: Patient -> Appointment
 * Links a patient to their scheduled appointments.
 */
export interface HasAppointmentRelationship {
  readonly type: 'HAS_APPOINTMENT';
  readonly sourceId: string;  // Patient node ID
  readonly targetId: string;  // Appointment node ID
  readonly tenantId: string;
}

/**
 * FOLLOWS_PLAN: Patient -> CarePlan
 * Links a patient to their active care plan.
 */
export interface FollowsPlanRelationship {
  readonly type: 'FOLLOWS_PLAN';
  readonly sourceId: string;  // Patient node ID
  readonly targetId: string;  // CarePlan node ID
  readonly tenantId: string;
  readonly enrolledDate: string;
}

/**
 * REFERRED_TO: Provider -> Provider
 * Tracks referral relationships between providers.
 */
export interface ReferredToRelationship {
  readonly type: 'REFERRED_TO';
  readonly sourceId: string;  // Referring Provider node ID
  readonly targetId: string;  // Referred Provider node ID
  readonly tenantId: string;
  readonly referralDate: string;
  readonly reason: string;
}

export type HealthcareRelationship =
  | TreatedByRelationship
  | HasAppointmentRelationship
  | FollowsPlanRelationship
  | ReferredToRelationship;
