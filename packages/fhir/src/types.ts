/**
 * FHIR R4 resource type definitions
 *
 * Covers the subset of FHIR R4 resources relevant to ORDR-Connect's healthcare
 * interoperability use cases: Patient (customer import/export), Communication
 * (message sync), Bundle (bulk operations), CapabilityStatement (conformance),
 * and OperationOutcome (structured errors).
 *
 * Reference: https://hl7.org/fhir/R4/
 *
 * HIPAA §164.312(a) — Access control: PHI fields are optional; de-identification
 *   is enforced by the mappers, not by these types.
 * HIPAA §164.514(b) — De-identification safe harbor: identifier systems use
 *   tenant-scoped token URNs, never raw PII values in API responses.
 */

// ─── Base ────────────────────────────────────────────────────────

export type FhirResourceType =
  | 'Patient'
  | 'Communication'
  | 'Appointment'
  | 'Bundle'
  | 'OperationOutcome'
  | 'CapabilityStatement'
  | 'Subscription';

export interface FhirCoding {
  readonly system?: string | undefined;
  readonly code?: string | undefined;
  readonly display?: string | undefined;
}

export interface FhirCodeableConcept {
  readonly coding?: readonly FhirCoding[] | undefined;
  readonly text?: string | undefined;
}

export interface FhirReference {
  readonly reference?: string | undefined;
  readonly type?: string | undefined;
  readonly display?: string | undefined;
}

export interface FhirIdentifier {
  readonly use?: 'usual' | 'official' | 'temp' | 'secondary' | 'old' | undefined;
  readonly system?: string | undefined;
  readonly value?: string | undefined;
}

export interface FhirContactPoint {
  readonly system?: 'phone' | 'fax' | 'email' | 'pager' | 'url' | 'sms' | 'other' | undefined;
  readonly value?: string | undefined;
  readonly use?: 'home' | 'work' | 'temp' | 'old' | 'mobile' | undefined;
  readonly rank?: number | undefined;
}

export interface FhirHumanName {
  readonly use?:
    | 'usual'
    | 'official'
    | 'temp'
    | 'nickname'
    | 'anonymous'
    | 'old'
    | 'maiden'
    | undefined;
  readonly family?: string | undefined;
  readonly given?: readonly string[] | undefined;
  readonly text?: string | undefined;
}

export interface FhirAddress {
  readonly use?: 'home' | 'work' | 'temp' | 'old' | 'billing' | undefined;
  readonly line?: readonly string[] | undefined;
  readonly city?: string | undefined;
  readonly state?: string | undefined;
  readonly postalCode?: string | undefined;
  readonly country?: string | undefined;
  readonly text?: string | undefined;
}

export interface FhirMeta {
  readonly versionId?: string | undefined;
  readonly lastUpdated?: string | undefined;
  readonly profile?: readonly string[] | undefined;
}

// ─── Patient ─────────────────────────────────────────────────────

/**
 * FHIR R4 Patient resource.
 *
 * In ORDR-Connect, Patient maps 1:1 to a Customer record.
 * PHI fields (name, birthDate, gender, telecom, address) are ONLY populated
 * when the caller holds the `fhir:read:phi` permission AND the tenant has an
 * active BAA on file.  Otherwise the mappers return a de-identified Patient
 * containing only the tokenized `id` and business-context identifiers.
 */
export interface FhirPatient {
  readonly resourceType: 'Patient';
  readonly id?: string | undefined;
  readonly meta?: FhirMeta | undefined;
  readonly identifier?: readonly FhirIdentifier[] | undefined;
  /** RESTRICTED — PHI.  Only present with fhir:read:phi permission. */
  readonly name?: readonly FhirHumanName[] | undefined;
  /** RESTRICTED — PHI. */
  readonly telecom?: readonly FhirContactPoint[] | undefined;
  /** RESTRICTED — PHI. */
  readonly gender?: 'male' | 'female' | 'other' | 'unknown' | undefined;
  /** RESTRICTED — PHI. */
  readonly birthDate?: string | undefined;
  /** RESTRICTED — PHI. */
  readonly address?: readonly FhirAddress[] | undefined;
  readonly active?: boolean | undefined;
}

// ─── Communication ───────────────────────────────────────────────

export interface FhirAttachment {
  readonly contentType?: string | undefined;
  readonly url?: string | undefined;
  readonly title?: string | undefined;
}

export interface FhirCommunicationPayload {
  readonly contentString?: string | undefined;
  readonly contentAttachment?: FhirAttachment | undefined;
  readonly contentReference?: FhirReference | undefined;
}

/**
 * FHIR R4 Communication resource.
 * Maps to ORDR-Connect Message records.
 *
 * Content is NEVER returned inline — the `payload.contentAttachment.url`
 * carries the contentRef (pointer to encrypted content store), matching
 * the metadata-only rule from messages.ts.
 */
export interface FhirCommunication {
  readonly resourceType: 'Communication';
  readonly id?: string | undefined;
  readonly meta?: FhirMeta | undefined;
  readonly identifier?: readonly FhirIdentifier[] | undefined;
  readonly status:
    | 'preparation'
    | 'in-progress'
    | 'not-done'
    | 'on-hold'
    | 'stopped'
    | 'completed'
    | 'entered-in-error'
    | 'unknown';
  readonly category?: readonly FhirCodeableConcept[] | undefined;
  readonly medium?: readonly FhirCodeableConcept[] | undefined;
  readonly subject?: FhirReference | undefined;
  readonly sender?: FhirReference | undefined;
  readonly recipient?: readonly FhirReference[] | undefined;
  readonly sent?: string | undefined;
  readonly received?: string | undefined;
  /** contentRef URL only — no PHI/content inline */
  readonly payload?: readonly FhirCommunicationPayload[] | undefined;
  readonly note?: readonly { readonly text: string }[] | undefined;
}

// ─── Bundle ──────────────────────────────────────────────────────

export type FhirBundleType =
  | 'document'
  | 'message'
  | 'transaction'
  | 'transaction-response'
  | 'batch'
  | 'batch-response'
  | 'history'
  | 'searchset'
  | 'collection';

export interface FhirBundleEntry<T = FhirPatient | FhirCommunication> {
  readonly fullUrl?: string | undefined;
  readonly resource?: T | undefined;
  readonly request?:
    | {
        readonly method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
        readonly url: string;
      }
    | undefined;
  readonly response?:
    | {
        readonly status: string;
        readonly location?: string | undefined;
      }
    | undefined;
  readonly search?:
    | {
        readonly mode?: 'match' | 'include' | 'outcome' | undefined;
        readonly score?: number | undefined;
      }
    | undefined;
}

export interface FhirBundle<T = FhirPatient | FhirCommunication> {
  readonly resourceType: 'Bundle';
  readonly id?: string | undefined;
  readonly meta?: FhirMeta | undefined;
  readonly type: FhirBundleType;
  readonly total?: number | undefined;
  readonly timestamp?: string | undefined;
  readonly link?:
    | readonly {
        readonly relation: string;
        readonly url: string;
      }[]
    | undefined;
  readonly entry?: readonly FhirBundleEntry<T>[] | undefined;
}

// ─── OperationOutcome ────────────────────────────────────────────

export interface FhirOperationOutcomeIssue {
  readonly severity: 'fatal' | 'error' | 'warning' | 'information';
  readonly code: string;
  readonly details?: FhirCodeableConcept | undefined;
  readonly diagnostics?: string | undefined;
  readonly expression?: readonly string[] | undefined;
}

export interface FhirOperationOutcome {
  readonly resourceType: 'OperationOutcome';
  readonly issue: readonly FhirOperationOutcomeIssue[];
}

// ─── CapabilityStatement ─────────────────────────────────────────

export interface FhirCapabilityStatementResource {
  readonly type: string;
  readonly interaction: readonly { readonly code: string }[];
  readonly operation?:
    | readonly { readonly name: string; readonly definition: string }[]
    | undefined;
}

export interface FhirCapabilityStatement {
  readonly resourceType: 'CapabilityStatement';
  readonly status: 'draft' | 'active' | 'retired' | 'unknown';
  readonly date: string;
  readonly kind: 'instance';
  readonly fhirVersion: '4.0.1';
  readonly format: readonly string[];
  readonly rest: readonly {
    readonly mode: 'server';
    readonly resource: readonly FhirCapabilityStatementResource[];
  }[];
}

// ─── Subscription ────────────────────────────────────────────────

export interface FhirSubscription {
  readonly resourceType: 'Subscription';
  readonly id?: string | undefined;
  readonly status: 'requested' | 'active' | 'error' | 'off';
  readonly reason: string;
  readonly criteria: string;
  readonly channel: {
    readonly type: 'rest-hook' | 'websocket' | 'email' | 'sms' | 'message';
    readonly endpoint?: string | undefined;
    readonly payload?: string | undefined;
    readonly header?: readonly string[] | undefined;
  };
}
