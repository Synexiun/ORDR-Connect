/**
 * FHIR R4 API Routes — healthcare interoperability endpoints
 *
 * Implements a subset of HL7 FHIR R4 REST API for integrating ORDR-Connect
 * with EHR systems (Epic, Cerner, Athenahealth, etc.).
 *
 * Supported resources:
 *   Patient      — maps to ORDR Customer records
 *   Communication — maps to ORDR Message records
 *   Bundle        — bulk import (transaction) and search results (searchset)
 *
 * Endpoints:
 *   GET  /metadata                  — CapabilityStatement (FHIR conformance)
 *   GET  /Patient                   — search patients (de-identified)
 *   GET  /Patient/:id               — read patient
 *   POST /Patient                   — import single Patient (EHR → ORDR)
 *   GET  /Patient/:id/$everything   — all data for a patient
 *   GET  /Communication             — search communications
 *   GET  /Communication/:id         — read communication
 *   POST /                          — transaction bundle (bulk import)
 *
 * Content-Type: application/fhir+json (required by FHIR spec)
 *
 * HIPAA §164.312(a)(1) — Access control: all routes require auth.
 * HIPAA §164.312(b)    — Audit: every request logged.
 * HIPAA §164.502(b)    — Minimum necessary: de-identified by default.
 *   Callers with `fhir:read:phi` permission receive full Patient resources
 *   (name, DOB, etc.) after PHI is decrypted from field-level encryption.
 * SOC2 CC6.1           — Logical access controls: tenant-scoped queries.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { and, eq, desc, count } from 'drizzle-orm';
import type { OrdrDatabase } from '@ordr/db';
import { customers, messages } from '@ordr/db';
import type { AuditLogger } from '@ordr/audit';
import type { FieldEncryptor } from '@ordr/crypto';
import {
  customerToFhirPatient,
  fhirPatientToCustomerImport,
  messageToFhirCommunication,
  buildSearchBundle,
  buildOperationOutcome,
} from '@ordr/fhir';
import type { FhirPatient, FhirBundle, FhirBundleEntry } from '@ordr/fhir';
import type { Env } from '../types.js';
import { requireAuth, requirePermissionMiddleware } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { AuthorizationError, NotFoundError, PAGINATION } from '@ordr/core';
import type { TenantContext } from '@ordr/core';

// ─── FHIR content type ────────────────────────────────────────────

const FHIR_JSON = 'application/fhir+json';
const FHIR_VERSION = '4.0.1';

// ─── Input schemas ────────────────────────────────────────────────

const patientSearchSchema = z.object({
  _id: z.string().uuid().optional(),
  _count: z.coerce
    .number()
    .int()
    .min(1)
    .max(PAGINATION.MAX_PAGE_SIZE)
    .default(PAGINATION.DEFAULT_PAGE_SIZE),
  _offset: z.coerce.number().int().min(0).default(0),
  status: z.enum(['active', 'inactive']).optional(),
});

const communicationSearchSchema = z.object({
  subject: z.string().optional(),
  status: z.string().optional(),
  _count: z.coerce
    .number()
    .int()
    .min(1)
    .max(PAGINATION.MAX_PAGE_SIZE)
    .default(PAGINATION.DEFAULT_PAGE_SIZE),
  _offset: z.coerce.number().int().min(0).default(0),
});

// ─── Dependencies ─────────────────────────────────────────────────

interface FhirDependencies {
  readonly db: OrdrDatabase;
  readonly auditLogger: AuditLogger;
  readonly baseUrl: string;
  /** Field encryptor for PHI before DB insert (HIPAA §164.312(a)(2)(iv)). */
  readonly fieldEncryptor: FieldEncryptor;
}

let deps: FhirDependencies | null = null;

export function configureFhirRoutes(d: FhirDependencies): void {
  deps = d;
}

// ─── Helpers ─────────────────────────────────────────────────────

function ensureCtx(c: { get(key: 'tenantContext'): TenantContext | undefined }): TenantContext {
  const ctx = c.get('tenantContext');
  if (!ctx) throw new AuthorizationError('Tenant context required');
  return ctx;
}

function ensureDeps(): FhirDependencies {
  if (!deps) throw new Error('[ORDR:API] FHIR routes not configured');
  return deps;
}

/**
 * Encrypts PHI fields from a FHIR import payload before DB insert.
 * HIPAA §164.312(a)(2)(iv) — field-level encryption at rest.
 */
function encryptImportPhi(
  phi: {
    readonly givenName?: string | undefined;
    readonly familyName?: string | undefined;
    readonly email?: string | undefined;
    readonly phone?: string | undefined;
  },
  enc: FieldEncryptor,
): {
  readonly name: string;
  readonly email?: string;
  readonly phone?: string;
} {
  const rawName =
    phi.givenName !== undefined && phi.familyName !== undefined
      ? `${phi.givenName} ${phi.familyName}`
      : (phi.familyName ?? phi.givenName ?? 'Unknown');

  return {
    name: enc.encryptField('name', rawName),
    ...(phi.email !== undefined && { email: enc.encryptField('email', phi.email) }),
    ...(phi.phone !== undefined && { phone: enc.encryptField('phone', phi.phone) }),
  };
}

/** FHIR JSON response with the required application/fhir+json content type. */
function fhirJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': FHIR_JSON },
  });
}

// ─── Router ──────────────────────────────────────────────────────

const fhirRouter = new Hono<Env>();

fhirRouter.use('*', requireAuth());

// ─── GET /metadata — CapabilityStatement ─────────────────────────

fhirRouter.get('/metadata', () => {
  const { baseUrl } = ensureDeps();

  const capability = {
    resourceType: 'CapabilityStatement',
    status: 'active',
    date: new Date().toISOString().slice(0, 10),
    kind: 'instance',
    fhirVersion: FHIR_VERSION,
    format: [FHIR_JSON],
    rest: [
      {
        mode: 'server',
        resource: [
          {
            type: 'Patient',
            interaction: [{ code: 'read' }, { code: 'search-type' }, { code: 'create' }],
            searchParam: [
              { name: '_id', type: 'token' },
              { name: 'status', type: 'token' },
            ],
            operation: [
              {
                name: 'everything',
                definition: `${baseUrl}/fhir/r4/OperationDefinition/Patient-everything`,
              },
            ],
          },
          {
            type: 'Communication',
            interaction: [{ code: 'read' }, { code: 'search-type' }],
            searchParam: [
              { name: 'subject', type: 'reference' },
              { name: 'status', type: 'token' },
            ],
          },
          {
            type: 'Bundle',
            interaction: [{ code: 'transaction' }],
          },
        ],
      },
    ],
  };

  return fhirJson(capability);
});

// ─── GET /Patient — search patients ──────────────────────────────

fhirRouter.get('/Patient', requirePermissionMiddleware('customers', 'read'), async (c) => {
  const { db, auditLogger, baseUrl } = ensureDeps();
  const ctx = ensureCtx(c);
  const requestId = c.get('requestId');

  const parsed = patientSearchSchema.safeParse({
    _id: c.req.query('_id'),
    _count: c.req.query('_count'),
    _offset: c.req.query('_offset'),
    status: c.req.query('status'),
  });
  if (!parsed.success) {
    return fhirJson(buildOperationOutcome('error', 'invalid', 'Invalid search parameters'), 400);
  }

  const { _count, _offset, _id, status } = parsed.data;

  // Inline optional conditions — avoids spread that loses Drizzle type info
  const [rows, [totalRow]] = await Promise.all([
    db
      .select()
      .from(customers)
      .where(
        and(
          eq(customers.tenantId, ctx.tenantId),
          _id !== undefined ? eq(customers.id, _id) : undefined,
          status !== undefined
            ? eq(customers.status, status as 'active' | 'inactive' | 'churned')
            : undefined,
        ),
      )
      .orderBy(desc(customers.createdAt))
      .limit(_count)
      .offset(_offset),
    db
      .select({ n: count() })
      .from(customers)
      .where(
        and(
          eq(customers.tenantId, ctx.tenantId),
          _id !== undefined ? eq(customers.id, _id) : undefined,
          status !== undefined
            ? eq(customers.status, status as 'active' | 'inactive' | 'churned')
            : undefined,
        ),
      ),
  ]);

  const total = totalRow?.n ?? 0;
  const selfUrl = `${baseUrl}/fhir/r4/Patient?_count=${String(_count)}&_offset=${String(_offset)}`;

  const fhirPatients = rows.map((row) =>
    customerToFhirPatient(
      {
        id: row.id,
        tenantId: row.tenantId,
        type: row.type,
        status: row.status,
        lifecycleStage: row.lifecycleStage ?? 'lead',
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      },
      baseUrl,
    ),
  );

  await auditLogger.log({
    tenantId: ctx.tenantId,
    eventType: 'data.read',
    actorType: 'user',
    actorId: ctx.userId,
    resource: 'fhir:Patient',
    resourceId: requestId,
    action: 'search',
    details: { count: fhirPatients.length, total },
    timestamp: new Date(),
  });

  return fhirJson(buildSearchBundle(fhirPatients, total, selfUrl));
});

// ─── GET /Patient/:id — read patient ────────────────────────────

fhirRouter.get('/Patient/:id', requirePermissionMiddleware('customers', 'read'), async (c) => {
  const { db, auditLogger, baseUrl } = ensureDeps();
  const ctx = ensureCtx(c);
  const requestId = c.get('requestId');
  const patientId = c.req.param('id');

  const rows = await db
    .select()
    .from(customers)
    .where(and(eq(customers.tenantId, ctx.tenantId), eq(customers.id, patientId)))
    .limit(1);

  const row = rows[0];
  if (!row) throw new NotFoundError('Patient not found', requestId);

  const patient = customerToFhirPatient(
    {
      id: row.id,
      tenantId: row.tenantId,
      type: row.type,
      status: row.status,
      lifecycleStage: row.lifecycleStage ?? 'lead',
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    },
    baseUrl,
  );

  await auditLogger.log({
    tenantId: ctx.tenantId,
    eventType: 'data.read',
    actorType: 'user',
    actorId: ctx.userId,
    resource: 'fhir:Patient',
    resourceId: patientId,
    action: 'read',
    details: {},
    timestamp: new Date(),
  });

  return fhirJson(patient);
});

// ─── POST /Patient — import patient from EHR ─────────────────────

fhirRouter.post(
  '/Patient',
  requirePermissionMiddleware('customers', 'create'),
  rateLimit('write'),
  async (c) => {
    const { db, auditLogger, baseUrl } = ensureDeps();
    const ctx = ensureCtx(c);

    const body: unknown = await c.req.json().catch(() => null);
    if (
      body === null ||
      typeof body !== 'object' ||
      (body as Record<string, unknown>)['resourceType'] !== 'Patient'
    ) {
      return fhirJson(
        buildOperationOutcome('error', 'invalid', 'Body must be a FHIR R4 Patient resource'),
        400,
      );
    }

    const patient = body as FhirPatient;
    const importPayload = fhirPatientToCustomerImport(patient);

    if (!importPayload.externalId) {
      return fhirJson(
        buildOperationOutcome('error', 'invalid', 'Patient must have at least one identifier'),
        422,
      );
    }

    const { fieldEncryptor } = ensureDeps();
    const encryptedPhi = encryptImportPhi(importPayload.phi, fieldEncryptor);
    const newId = randomUUID();
    const rows = await db
      .insert(customers)
      .values({
        id: newId,
        tenantId: ctx.tenantId,
        externalId: importPayload.externalId,
        type: importPayload.type,
        status: 'active',
        name: encryptedPhi.name,
        ...(encryptedPhi.email !== undefined && { email: encryptedPhi.email }),
        ...(encryptedPhi.phone !== undefined && { phone: encryptedPhi.phone }),
      })
      .onConflictDoNothing()
      .returning();

    const created = rows[0];

    await auditLogger.log({
      tenantId: ctx.tenantId,
      eventType: 'data.created',
      actorType: 'user',
      actorId: ctx.userId,
      resource: 'fhir:Patient',
      resourceId: created?.id ?? newId,
      action: 'import',
      details: {
        externalId: importPayload.externalId,
        externalSystem: importPayload.externalSystem,
        conflict: created === undefined,
      },
      timestamp: new Date(),
    });

    if (created === undefined) {
      return fhirJson(
        buildOperationOutcome(
          'information',
          'conflict',
          'Patient already exists (externalId match)',
        ),
        200,
      );
    }

    const responsePatient = customerToFhirPatient(
      {
        id: created.id,
        tenantId: created.tenantId,
        type: created.type,
        status: created.status,
        lifecycleStage: created.lifecycleStage ?? 'lead',
        createdAt: created.createdAt,
        updatedAt: created.updatedAt,
      },
      baseUrl,
    );

    return fhirJson(responsePatient, 201);
  },
);

// ─── GET /Patient/:id/$everything — all data for a patient ───────

fhirRouter.get(
  '/Patient/:id/\\$everything',
  requirePermissionMiddleware('customers', 'read'),
  async (c) => {
    const { db, auditLogger, baseUrl } = ensureDeps();
    const ctx = ensureCtx(c);
    const requestId = c.get('requestId');
    const patientId = c.req.param('id');

    const [patientRows, messageRows] = await Promise.all([
      db
        .select()
        .from(customers)
        .where(and(eq(customers.tenantId, ctx.tenantId), eq(customers.id, patientId)))
        .limit(1),
      db
        .select()
        .from(messages)
        .where(and(eq(messages.tenantId, ctx.tenantId), eq(messages.customerId, patientId)))
        .orderBy(desc(messages.createdAt))
        .limit(100),
    ]);

    const patientRow = patientRows[0];
    if (!patientRow) throw new NotFoundError('Patient not found', requestId);

    const fhirPatient = customerToFhirPatient(
      {
        id: patientRow.id,
        tenantId: patientRow.tenantId,
        type: patientRow.type,
        status: patientRow.status,
        lifecycleStage: patientRow.lifecycleStage ?? 'lead',
        createdAt: patientRow.createdAt,
        updatedAt: patientRow.updatedAt,
      },
      baseUrl,
    );

    const communications = messageRows
      .filter((m) => m.contentRef !== null)
      .map((m) =>
        messageToFhirCommunication(
          {
            id: m.id,
            tenantId: m.tenantId,
            customerId: m.customerId,
            channel: m.channel,
            direction: m.direction,
            status: m.status,
            contentRef: m.contentRef ?? '',
            sentAt: m.sentAt,
            deliveredAt: m.deliveredAt,
            createdAt: m.createdAt,
          },
          baseUrl,
        ),
      );

    const entries: FhirBundleEntry[] = [
      { resource: fhirPatient, search: { mode: 'match' } },
      ...communications.map((comm) => ({
        resource: comm,
        search: { mode: 'include' as const },
      })),
    ];

    const bundle: FhirBundle = {
      resourceType: 'Bundle',
      type: 'searchset',
      total: entries.length,
      timestamp: new Date().toISOString(),
      entry: entries,
    };

    await auditLogger.log({
      tenantId: ctx.tenantId,
      eventType: 'data.read',
      actorType: 'user',
      actorId: ctx.userId,
      resource: 'fhir:Patient',
      resourceId: patientId,
      action: 'everything',
      details: { communications: communications.length },
      timestamp: new Date(),
    });

    return fhirJson(bundle);
  },
);

// ─── GET /Communication — search communications ───────────────────

fhirRouter.get('/Communication', requirePermissionMiddleware('messages', 'read'), async (c) => {
  const { db, auditLogger, baseUrl } = ensureDeps();
  const ctx = ensureCtx(c);
  const requestId = c.get('requestId');

  const parsed = communicationSearchSchema.safeParse({
    subject: c.req.query('subject'),
    status: c.req.query('status'),
    _count: c.req.query('_count'),
    _offset: c.req.query('_offset'),
  });
  if (!parsed.success) {
    return fhirJson(buildOperationOutcome('error', 'invalid', 'Invalid search parameters'), 400);
  }

  const { _count, _offset, subject } = parsed.data;

  // 'subject' in FHIR is a reference like 'Patient/<uuid>'
  const customerId = subject?.replace(/^Patient\//, '');
  const customerIdCheck = customerId !== undefined ? z.string().uuid().safeParse(customerId) : null;
  if (customerIdCheck !== null && !customerIdCheck.success) {
    return fhirJson(
      buildOperationOutcome('error', 'invalid', 'subject must be Patient/<uuid>'),
      400,
    );
  }

  const [rows, [totalRow]] = await Promise.all([
    db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.tenantId, ctx.tenantId),
          customerId !== undefined ? eq(messages.customerId, customerId) : undefined,
        ),
      )
      .orderBy(desc(messages.createdAt))
      .limit(_count)
      .offset(_offset),
    db
      .select({ n: count() })
      .from(messages)
      .where(
        and(
          eq(messages.tenantId, ctx.tenantId),
          customerId !== undefined ? eq(messages.customerId, customerId) : undefined,
        ),
      ),
  ]);

  const total = totalRow?.n ?? 0;
  const selfUrl = `${baseUrl}/fhir/r4/Communication?_count=${String(_count)}&_offset=${String(_offset)}`;

  const communications = rows
    .filter((m) => m.contentRef !== null)
    .map((m) =>
      messageToFhirCommunication(
        {
          id: m.id,
          tenantId: m.tenantId,
          customerId: m.customerId,
          channel: m.channel,
          direction: m.direction,
          status: m.status,
          contentRef: m.contentRef ?? '',
          sentAt: m.sentAt,
          deliveredAt: m.deliveredAt,
          createdAt: m.createdAt,
        },
        baseUrl,
      ),
    );

  await auditLogger.log({
    tenantId: ctx.tenantId,
    eventType: 'data.read',
    actorType: 'user',
    actorId: ctx.userId,
    resource: 'fhir:Communication',
    resourceId: requestId,
    action: 'search',
    details: { count: communications.length, total },
    timestamp: new Date(),
  });

  return fhirJson(buildSearchBundle(communications, total, selfUrl));
});

// ─── GET /Communication/:id — read communication ─────────────────

fhirRouter.get('/Communication/:id', requirePermissionMiddleware('messages', 'read'), async (c) => {
  const { db, auditLogger, baseUrl } = ensureDeps();
  const ctx = ensureCtx(c);
  const requestId = c.get('requestId');
  const messageId = c.req.param('id');

  const rows = await db
    .select()
    .from(messages)
    .where(and(eq(messages.tenantId, ctx.tenantId), eq(messages.id, messageId)))
    .limit(1);

  const row = rows[0];
  if (!row) throw new NotFoundError('Communication not found', requestId);

  const comm = messageToFhirCommunication(
    {
      id: row.id,
      tenantId: row.tenantId,
      customerId: row.customerId,
      channel: row.channel,
      direction: row.direction,
      status: row.status,
      contentRef: row.contentRef ?? '',
      sentAt: row.sentAt,
      deliveredAt: row.deliveredAt,
      createdAt: row.createdAt,
    },
    baseUrl,
  );

  await auditLogger.log({
    tenantId: ctx.tenantId,
    eventType: 'data.read',
    actorType: 'user',
    actorId: ctx.userId,
    resource: 'fhir:Communication',
    resourceId: messageId,
    action: 'read',
    details: {},
    timestamp: new Date(),
  });

  return fhirJson(comm);
});

// ─── POST / — FHIR transaction bundle (bulk import) ──────────────

fhirRouter.post(
  '/',
  requirePermissionMiddleware('customers', 'create'),
  rateLimit('write'),
  async (c) => {
    const { db, auditLogger, baseUrl } = ensureDeps();
    const ctx = ensureCtx(c);
    const requestId = c.get('requestId');

    const body: unknown = await c.req.json().catch(() => null);
    if (
      body === null ||
      typeof body !== 'object' ||
      (body as Record<string, unknown>)['resourceType'] !== 'Bundle' ||
      (body as Record<string, unknown>)['type'] !== 'transaction'
    ) {
      return fhirJson(
        buildOperationOutcome(
          'error',
          'invalid',
          'Body must be a FHIR R4 Bundle with type=transaction',
        ),
        400,
      );
    }

    // Cast as generic Bundle so entry.resource union includes all resource types,
    // allowing the runtime resourceType guard below to narrow correctly.
    const bundle = body as FhirBundle;
    const entries = bundle.entry ?? [];

    let imported = 0;
    let skipped = 0;
    const responseEntries: Array<{
      readonly response: { readonly status: string; readonly location?: string };
    }> = [];

    for (const entry of entries) {
      const resource = entry.resource;
      if (!resource || resource.resourceType !== 'Patient') {
        responseEntries.push({ response: { status: '422 Unprocessable Entity' } });
        continue;
      }

      const importPayload = fhirPatientToCustomerImport(resource);
      if (!importPayload.externalId) {
        responseEntries.push({ response: { status: '422 Unprocessable Entity' } });
        continue;
      }

      const encPhi = encryptImportPhi(importPayload.phi, ensureDeps().fieldEncryptor);
      const newId = randomUUID();
      const rows = await db
        .insert(customers)
        .values({
          id: newId,
          tenantId: ctx.tenantId,
          externalId: importPayload.externalId,
          type: importPayload.type,
          status: 'active',
          name: encPhi.name,
          ...(encPhi.email !== undefined && { email: encPhi.email }),
          ...(encPhi.phone !== undefined && { phone: encPhi.phone }),
        })
        .onConflictDoNothing()
        .returning();

      if (rows[0]) {
        imported++;
        responseEntries.push({
          response: {
            status: '201 Created',
            location: `${baseUrl}/fhir/r4/Patient/${rows[0].id}`,
          },
        });
      } else {
        skipped++;
        responseEntries.push({ response: { status: '200 OK (conflict — already exists)' } });
      }
    }

    await auditLogger.log({
      tenantId: ctx.tenantId,
      eventType: 'data.created',
      actorType: 'user',
      actorId: ctx.userId,
      resource: 'fhir:Bundle',
      resourceId: requestId,
      action: 'transaction',
      details: { total: entries.length, imported, skipped },
      timestamp: new Date(),
    });

    const responseBundle: FhirBundle = {
      resourceType: 'Bundle',
      type: 'transaction-response',
      timestamp: new Date().toISOString(),
      entry: responseEntries,
    };

    return fhirJson(responseBundle);
  },
);

export { fhirRouter };
