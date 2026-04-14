/**
 * @ordr/fhir — FHIR R4 interoperability package
 *
 * Provides type definitions, bidirectional mappers, and an outbound FHIR
 * REST client for integrating ORDR-Connect with HL7 FHIR R4 compliant EHR systems.
 *
 * Usage:
 *   import { FhirClient, fhirPatientToCustomerImport } from '@ordr/fhir';
 */

// ─── Types ────────────────────────────────────────────────────────
export type {
  FhirResourceType,
  FhirPatient,
  FhirCommunication,
  FhirBundle,
  FhirBundleEntry,
  FhirBundleType,
  FhirOperationOutcome,
  FhirOperationOutcomeIssue,
  FhirCapabilityStatement,
  FhirCapabilityStatementResource,
  FhirSubscription,
  FhirCoding,
  FhirCodeableConcept,
  FhirReference,
  FhirIdentifier,
  FhirContactPoint,
  FhirHumanName,
  FhirAddress,
  FhirMeta,
  FhirCommunicationPayload,
} from './types.js';

// ─── Mappers ──────────────────────────────────────────────────────
export type { CustomerExportRow, MessageExportRow, CustomerImportPayload } from './mappers.js';

export {
  customerToFhirPatient,
  mergePhiIntoPatient,
  messageToFhirCommunication,
  fhirPatientToCustomerImport,
  buildSearchBundle,
  buildOperationOutcome,
} from './mappers.js';

// ─── Client ───────────────────────────────────────────────────────
export type { FhirClientConfig } from './client.js';
export { FhirClient, FhirClientError } from './client.js';
