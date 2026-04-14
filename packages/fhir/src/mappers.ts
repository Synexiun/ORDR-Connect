/**
 * FHIR R4 ↔ ORDR-Connect bidirectional mappers
 *
 * Two mapping directions:
 *
 *   Import (EHR → ORDR):
 *     fhirPatientToCustomerInsert — convert incoming Patient to DB insert payload
 *
 *   Export (ORDR → EHR / FHIR API):
 *     customerToFhirPatient     — convert Customer row to FHIR Patient (de-identified)
 *     messageToFhirCommunication — convert Message row to FHIR Communication
 *
 * PHI policy (HIPAA §164.514(b) safe harbor):
 *   - `customerToFhirPatient` NEVER includes decrypted PHI fields (name, DOB,
 *     email, phone).  Callers that hold `fhir:read:phi` must decrypt separately
 *     and merge via `mergePhiIntoPatient`.
 *   - Patient identifiers use tenant-scoped URN systems so they are reversible
 *     only within the same tenant (not across tenants).
 *
 * Status mapping (ORDR message status → FHIR Communication status):
 *   pending/queued/retrying → 'preparation'
 *   sent/delivered          → 'completed'
 *   failed/bounced/dlq      → 'not-done'
 *   opted_out               → 'stopped'
 */

import type { FhirPatient, FhirCommunication, FhirIdentifier } from './types.js';

// ─── System URNs ────────────────────────────────────────────────

/**
 * Returns the tenant-scoped FHIR identifier system URN.
 * Ensures identifiers from different tenants never collide.
 */
function tenantSystem(tenantId: string): string {
  return `urn:ordr:tenant:${tenantId}:customer`;
}

const MESSAGE_SYSTEM = 'urn:ordr:message';

// ─── Status Maps ────────────────────────────────────────────────

type MessageStatus =
  | 'pending'
  | 'queued'
  | 'sent'
  | 'delivered'
  | 'failed'
  | 'bounced'
  | 'opted_out'
  | 'retrying'
  | 'dlq';

type FhirCommStatus = FhirCommunication['status'];

const MESSAGE_STATUS_TO_FHIR: Readonly<Partial<Record<MessageStatus, FhirCommStatus>>> = {
  pending: 'preparation',
  queued: 'preparation',
  retrying: 'preparation',
  sent: 'completed',
  delivered: 'completed',
  failed: 'not-done',
  bounced: 'not-done',
  dlq: 'not-done',
  opted_out: 'stopped',
};

const CHANNEL_TO_MEDIUM: Readonly<Record<string, string>> = {
  sms: 'http://terminology.hl7.org/CodeSystem/v3-ParticipationMode|SMSWRIT',
  email: 'http://terminology.hl7.org/CodeSystem/v3-ParticipationMode|WRITTEN',
  voice: 'http://terminology.hl7.org/CodeSystem/v3-ParticipationMode|VOICE',
  whatsapp: 'http://terminology.hl7.org/CodeSystem/v3-ParticipationMode|SMSWRIT',
};

// ─── Export Mappers (ORDR → FHIR) ───────────────────────────────

export interface CustomerExportRow {
  readonly id: string;
  readonly tenantId: string;
  readonly type: string;
  readonly status: string;
  readonly lifecycleStage: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Converts an ORDR Customer row to a de-identified FHIR Patient resource.
 *
 * PHI fields (name, DOB, email, phone) are deliberately excluded.
 * The identifier carries only the tokenized customer ID within the tenant
 * namespace — no raw PII is exposed.
 *
 * Callers with `fhir:read:phi` should call `mergePhiIntoPatient()` after
 * decrypting the PHI separately.
 */
export function customerToFhirPatient(customer: CustomerExportRow, baseUrl: string): FhirPatient {
  const identifiers: FhirIdentifier[] = [
    {
      use: 'official',
      system: tenantSystem(customer.tenantId),
      value: customer.id,
    },
  ];

  return {
    resourceType: 'Patient',
    id: customer.id,
    meta: {
      lastUpdated: customer.updatedAt.toISOString(),
      profile: [`${baseUrl}/StructureDefinition/ordr-patient`],
    },
    identifier: identifiers,
    active: customer.status === 'active',
  };
}

/**
 * Merges decrypted PHI fields into a de-identified Patient.
 * Only called by routes that have verified `fhir:read:phi` permission.
 */
export function mergePhiIntoPatient(
  patient: FhirPatient,
  phi: {
    readonly givenName?: string | undefined;
    readonly familyName?: string | undefined;
    readonly email?: string | undefined;
    readonly phone?: string | undefined;
    readonly birthDate?: string | undefined;
    readonly gender?: 'male' | 'female' | 'other' | 'unknown' | undefined;
  },
): FhirPatient {
  return {
    ...patient,
    name:
      phi.givenName !== undefined || phi.familyName !== undefined
        ? [
            {
              use: 'official' as const,
              ...(phi.familyName !== undefined && { family: phi.familyName }),
              ...(phi.givenName !== undefined && { given: [phi.givenName] as readonly string[] }),
            },
          ]
        : undefined,
    telecom:
      [
        ...(phi.email !== undefined
          ? [{ system: 'email' as const, value: phi.email, use: 'work' as const }]
          : []),
        ...(phi.phone !== undefined
          ? [{ system: 'phone' as const, value: phi.phone, use: 'mobile' as const }]
          : []),
      ].length > 0
        ? [
            ...(phi.email !== undefined
              ? [{ system: 'email' as const, value: phi.email, use: 'work' as const }]
              : []),
            ...(phi.phone !== undefined
              ? [{ system: 'phone' as const, value: phi.phone, use: 'mobile' as const }]
              : []),
          ]
        : undefined,
    ...(phi.birthDate !== undefined && { birthDate: phi.birthDate }),
    ...(phi.gender !== undefined && { gender: phi.gender }),
  };
}

export interface MessageExportRow {
  readonly id: string;
  readonly tenantId: string;
  readonly customerId: string;
  readonly channel: string;
  readonly direction: string;
  readonly status: string;
  readonly contentRef: string;
  readonly sentAt: Date | null;
  readonly deliveredAt: Date | null;
  readonly createdAt: Date;
}

/**
 * Converts an ORDR Message row to a FHIR Communication resource.
 *
 * Content is NEVER included inline (SOC2 CC6.1 / HIPAA §164.312(a)(2)(iv)).
 * The `contentRef` is surfaced as `payload[0].contentAttachment.url` so the
 * receiving system knows a reference exists but cannot access the content
 * without the encryption key.
 */
export function messageToFhirCommunication(
  message: MessageExportRow,
  baseUrl: string,
): FhirCommunication {
  const status: FhirCommStatus =
    MESSAGE_STATUS_TO_FHIR[message.status as MessageStatus] ?? 'unknown';

  const mediumCode = CHANNEL_TO_MEDIUM[message.channel];
  const [medSystem, medCode] = mediumCode?.split('|') ?? [];

  return {
    resourceType: 'Communication',
    id: message.id,
    meta: {
      lastUpdated: message.createdAt.toISOString(),
    },
    identifier: [
      {
        system: MESSAGE_SYSTEM,
        value: message.id,
      },
    ],
    status,
    ...(medSystem !== undefined &&
      medCode !== undefined && {
        medium: [
          {
            coding: [{ system: medSystem, code: medCode }],
          },
        ],
      }),
    subject: {
      reference: `${baseUrl}/fhir/r4/Patient/${message.customerId}`,
      type: 'Patient',
    },
    ...(message.direction === 'outbound'
      ? {
          recipient: [
            {
              reference: `${baseUrl}/fhir/r4/Patient/${message.customerId}`,
              type: 'Patient',
            },
          ],
        }
      : {
          sender: {
            reference: `${baseUrl}/fhir/r4/Patient/${message.customerId}`,
            type: 'Patient',
          },
        }),
    ...(message.sentAt !== null && { sent: message.sentAt.toISOString() }),
    ...(message.deliveredAt !== null && { received: message.deliveredAt.toISOString() }),
    // SECURITY: contentRef as URL attachment — no decrypted content
    payload: [
      {
        contentAttachment: {
          contentType: 'text/plain',
          url: message.contentRef,
          title: 'Message content reference (encrypted)',
        },
      },
    ],
  };
}

// ─── Import Mappers (FHIR → ORDR) ───────────────────────────────

export interface CustomerImportPayload {
  readonly externalId: string;
  readonly externalSystem: string;
  /** Mapped to ORDR customer type: FHIR Patient → individual, Organization → company */
  readonly type: 'individual' | 'company';
  /** Raw PHI — caller must encrypt before DB insert */
  readonly phi: {
    readonly givenName?: string | undefined;
    readonly familyName?: string | undefined;
    readonly email?: string | undefined;
    readonly phone?: string | undefined;
    readonly birthDate?: string | undefined;
    readonly gender?: string | undefined;
  };
}

/**
 * Converts a FHIR R4 Patient resource to an ORDR customer import payload.
 *
 * Returns raw PHI — the caller MUST encrypt these fields before writing to
 * the database (HIPAA §164.312(a)(2)(iv) field-level encryption requirement).
 *
 * The `externalId` + `externalSystem` pair is used to detect existing records
 * (upsert semantics) and to record the EHR source for audit purposes.
 */
export function fhirPatientToCustomerImport(patient: FhirPatient): CustomerImportPayload {
  // Prefer the first official identifier as the external reference
  const primaryId =
    patient.identifier?.find((i) => i.use === 'official') ?? patient.identifier?.[0];

  const givenName = patient.name?.[0]?.given?.[0];
  const familyName = patient.name?.[0]?.family;
  const email = patient.telecom?.find((t) => t.system === 'email')?.value;
  const phone = patient.telecom?.find((t) => t.system === 'phone' || t.system === 'sms')?.value;

  return {
    externalId: primaryId?.value ?? patient.id ?? '',
    externalSystem: primaryId?.system ?? 'urn:unknown',
    type: 'individual',
    phi: {
      ...(givenName !== undefined && { givenName }),
      ...(familyName !== undefined && { familyName }),
      ...(email !== undefined && { email }),
      ...(phone !== undefined && { phone }),
      ...(patient.birthDate !== undefined && { birthDate: patient.birthDate }),
      ...(patient.gender !== undefined && { gender: patient.gender }),
    },
  };
}

// ─── Bundle Builders ────────────────────────────────────────────

/**
 * Builds a FHIR searchset Bundle from a list of resources and a total count.
 */
export function buildSearchBundle<T>(
  resources: readonly T[],
  total: number,
  selfUrl: string,
): {
  readonly resourceType: 'Bundle';
  readonly type: 'searchset';
  readonly total: number;
  readonly timestamp: string;
  readonly link: readonly { readonly relation: string; readonly url: string }[];
  readonly entry: readonly { readonly resource: T; readonly search: { readonly mode: 'match' } }[];
} {
  return {
    resourceType: 'Bundle',
    type: 'searchset',
    total,
    timestamp: new Date().toISOString(),
    link: [{ relation: 'self', url: selfUrl }],
    entry: resources.map((resource) => ({ resource, search: { mode: 'match' as const } })),
  };
}

/**
 * Builds a FHIR OperationOutcome for use in error responses.
 */
export function buildOperationOutcome(
  severity: 'fatal' | 'error' | 'warning' | 'information',
  code: string,
  diagnostics: string,
): {
  readonly resourceType: 'OperationOutcome';
  readonly issue: readonly [
    {
      readonly severity: typeof severity;
      readonly code: string;
      readonly diagnostics: string;
    },
  ];
} {
  return {
    resourceType: 'OperationOutcome',
    issue: [{ severity, code, diagnostics }],
  };
}
