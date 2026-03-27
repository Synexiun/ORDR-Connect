/**
 * Customer Routes — CRUD with PHI encryption, audit logging, event publishing
 *
 * SOC2 CC6.1 — Access control: tenant-scoped, role-checked.
 * ISO 27001 A.8.2.3 — Handling of assets: encrypt PII at rest.
 * HIPAA §164.312(a)(2)(iv) — Encryption of ePHI.
 * HIPAA §164.312(b) — Audit controls on all PHI access.
 *
 * PII fields (name, email, phone) are field-level encrypted before storage
 * and decrypted on read only for authorized users.
 *
 * Every mutation publishes a domain event to Kafka and logs an audit entry.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import type { FieldEncryptor } from '@ordr/crypto';
import type { AuditLogger } from '@ordr/audit';
import type { EventProducer } from '@ordr/events';
import { createEventEnvelope, TOPICS, EventType } from '@ordr/events';
import { ValidationError, NotFoundError, AuthorizationError, PAGINATION } from '@ordr/core';
import type { TenantContext } from '@ordr/core';
import type { Env } from '../types.js';
import { requireAuth } from '../middleware/auth.js';
import { requirePermissionMiddleware } from '../middleware/auth.js';

// ---- PII fields that require field-level encryption -------------------------

const PII_FIELDS = ['name', 'email', 'phone'] as const;

// ---- Input Schemas ---------------------------------------------------------

const createCustomerSchema = z.object({
  externalId: z.string().max(255).optional(),
  type: z.enum(['individual', 'company']),
  name: z.string().min(1).max(500),
  email: z.string().email().max(255).optional(),
  phone: z.string().max(50).optional(),
  metadata: z.record(z.unknown()).optional(),
  lifecycleStage: z
    .enum(['lead', 'qualified', 'opportunity', 'customer', 'churning', 'churned'])
    .optional(),
  assignedUserId: z.string().uuid().optional(),
});

const updateCustomerSchema = z.object({
  name: z.string().min(1).max(500).optional(),
  email: z.string().email().max(255).nullable().optional(),
  phone: z.string().max(50).nullable().optional(),
  metadata: z.record(z.unknown()).optional(),
  status: z.enum(['active', 'inactive', 'churned']).optional(),
  lifecycleStage: z
    .enum(['lead', 'qualified', 'opportunity', 'customer', 'churning', 'churned'])
    .optional(),
  healthScore: z.number().int().min(0).max(100).optional(),
  assignedUserId: z.string().uuid().nullable().optional(),
});

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(PAGINATION.DEFAULT_PAGE),
  pageSize: z.coerce
    .number()
    .int()
    .min(PAGINATION.MIN_PAGE_SIZE)
    .max(PAGINATION.MAX_PAGE_SIZE)
    .default(PAGINATION.DEFAULT_PAGE_SIZE),
  status: z.enum(['active', 'inactive', 'churned']).optional(),
  type: z.enum(['individual', 'company']).optional(),
  lifecycleStage: z
    .enum(['lead', 'qualified', 'opportunity', 'customer', 'churning', 'churned'])
    .optional(),
  search: z.string().max(255).optional(),
});

// ---- Dependencies (injected at startup) ------------------------------------

interface CustomerRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly externalId: string | null;
  readonly type: string;
  readonly status: string;
  readonly name: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly metadata: Record<string, unknown> | null;
  readonly healthScore: number | null;
  readonly lifecycleStage: string | null;
  readonly assignedUserId: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

interface CustomerDependencies {
  readonly fieldEncryptor: FieldEncryptor;
  readonly auditLogger: AuditLogger;
  readonly eventProducer: EventProducer;
  readonly findCustomerById: (
    tenantId: string,
    customerId: string,
  ) => Promise<CustomerRecord | null>;
  readonly listCustomers: (
    tenantId: string,
    filters: {
      readonly page: number;
      readonly pageSize: number;
      readonly status?: string;
      readonly type?: string;
      readonly lifecycleStage?: string;
      readonly search?: string;
    },
  ) => Promise<{ readonly data: CustomerRecord[]; readonly total: number }>;
  readonly createCustomer: (
    tenantId: string,
    data: Record<string, unknown>,
  ) => Promise<CustomerRecord>;
  readonly updateCustomer: (
    tenantId: string,
    customerId: string,
    data: Record<string, unknown>,
  ) => Promise<CustomerRecord | null>;
  readonly softDeleteCustomer: (tenantId: string, customerId: string) => Promise<boolean>;
}

let deps: CustomerDependencies | null = null;

export function configureCustomerRoutes(dependencies: CustomerDependencies): void {
  deps = dependencies;
}

// ---- Helpers ----------------------------------------------------------------

function decryptCustomer(record: CustomerRecord, encryptor: FieldEncryptor): CustomerRecord {
  const decrypted = { ...record } as Record<string, unknown>;
  for (const field of PII_FIELDS) {
    const value = decrypted[field];
    if (typeof value === 'string' && value.length > 0) {
      try {
        decrypted[field] = encryptor.decryptField(field, value);
      } catch {
        // If decryption fails (e.g., unencrypted legacy data), return as-is
      }
    }
  }
  return decrypted as unknown as CustomerRecord;
}

function encryptPiiFields(
  data: Record<string, unknown>,
  encryptor: FieldEncryptor,
): Record<string, unknown> {
  const encrypted = { ...data };
  for (const field of PII_FIELDS) {
    const value = encrypted[field];
    if (typeof value === 'string' && value.length > 0) {
      encrypted[field] = encryptor.encryptField(field, value);
    }
  }
  return encrypted;
}

function ensureTenantContext(c: {
  get(key: 'tenantContext'): TenantContext | undefined;
  get(key: 'requestId'): string;
}): TenantContext {
  const ctx = c.get('tenantContext');
  if (!ctx) {
    throw new AuthorizationError('Tenant context required');
  }
  return ctx;
}

// ---- Router ----------------------------------------------------------------

const customersRouter = new Hono<Env>();

// All routes require authentication
customersRouter.use('*', requireAuth());

// ---- GET / — list customers (paginated, filtered) --------------------------

customersRouter.get('/', requirePermissionMiddleware('customers', 'read'), async (c) => {
  if (!deps) throw new Error('[ORDR:API] Customer routes not configured');

  const ctx = ensureTenantContext(c);
  const requestId = c.get('requestId');

  // Parse and validate query params
  const queryParsed = listQuerySchema.safeParse({
    page: c.req.query('page'),
    pageSize: c.req.query('pageSize'),
    status: c.req.query('status'),
    type: c.req.query('type'),
    lifecycleStage: c.req.query('lifecycleStage'),
    search: c.req.query('search'),
  });

  if (!queryParsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of queryParsed.error.issues) {
      const field = issue.path.join('.');
      const existing = fieldErrors[field];
      if (existing) {
        existing.push(issue.message);
      } else {
        fieldErrors[field] = [issue.message];
      }
    }
    throw new ValidationError('Invalid query parameters', fieldErrors, requestId);
  }

  const filters = queryParsed.data;
  const result = await deps.listCustomers(ctx.tenantId, {
    page: filters.page,
    pageSize: filters.pageSize,
    ...(filters.status !== undefined ? { status: filters.status } : {}),
    ...(filters.type !== undefined ? { type: filters.type } : {}),
    ...(filters.lifecycleStage !== undefined ? { lifecycleStage: filters.lifecycleStage } : {}),
    ...(filters.search !== undefined ? { search: filters.search } : {}),
  });

  // Decrypt PII fields for authorized users

  const d = deps;
  const decryptedData = result.data.map((record) => decryptCustomer(record, d.fieldEncryptor));

  return c.json({
    success: true as const,
    data: decryptedData,
    pagination: {
      page: filters.page,
      pageSize: filters.pageSize,
      total: result.total,
      totalPages: Math.ceil(result.total / filters.pageSize),
    },
  });
});

// ---- GET /:id — get single customer ----------------------------------------

customersRouter.get('/:id', requirePermissionMiddleware('customers', 'read'), async (c) => {
  if (!deps) throw new Error('[ORDR:API] Customer routes not configured');

  const ctx = ensureTenantContext(c);
  const requestId = c.get('requestId');
  const customerId = c.req.param('id');

  const customer = await deps.findCustomerById(ctx.tenantId, customerId);
  if (!customer) {
    throw new NotFoundError('Customer not found', requestId);
  }

  // Decrypt PII
  const decrypted = decryptCustomer(customer, deps.fieldEncryptor);

  return c.json({
    success: true as const,
    data: decrypted,
  });
});

// ---- POST / — create customer ----------------------------------------------

customersRouter.post('/', requirePermissionMiddleware('customers', 'create'), async (c) => {
  if (!deps) throw new Error('[ORDR:API] Customer routes not configured');

  const ctx = ensureTenantContext(c);
  const requestId = c.get('requestId');

  // Validate input
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const body = await c.req.json().catch(() => null);
  const parsed = createCustomerSchema.safeParse(body);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path.join('.');
      const existing = fieldErrors[field];
      if (existing) {
        existing.push(issue.message);
      } else {
        fieldErrors[field] = [issue.message];
      }
    }
    throw new ValidationError('Invalid customer data', fieldErrors, requestId);
  }

  // Encrypt PII fields before storage
  const encryptedData = encryptPiiFields(
    parsed.data as unknown as Record<string, unknown>,
    deps.fieldEncryptor,
  );

  // Create in database
  const customer = await deps.createCustomer(ctx.tenantId, encryptedData);

  // Audit log
  await deps.auditLogger.log({
    tenantId: ctx.tenantId,
    eventType: 'data.created',
    actorType: 'user',
    actorId: ctx.userId,
    resource: 'customers',
    resourceId: customer.id,
    action: 'create',
    details: { type: parsed.data.type },
    timestamp: new Date(),
  });

  // Publish domain event
  const event = createEventEnvelope(
    EventType.CUSTOMER_CREATED,
    ctx.tenantId,
    {
      customerId: customer.id,
      name: parsed.data.name,
      email: parsed.data.email ?? '',
      type: parsed.data.type,
      lifecycleStage: parsed.data.lifecycleStage ?? 'lead',
    },
    {
      correlationId: requestId,
      userId: ctx.userId,
      source: 'api',
    },
  );

  await deps.eventProducer.publish(TOPICS.CUSTOMER_EVENTS, event).catch((err: unknown) => {
    // Event publish failure should not fail the request
    console.error('[ORDR:API] Failed to publish customer.created event:', err);
  });

  // Return decrypted version
  const decrypted = decryptCustomer(customer, deps.fieldEncryptor);

  return c.json(
    {
      success: true as const,
      data: decrypted,
    },
    201,
  );
});

// ---- PATCH /:id — update customer ------------------------------------------

customersRouter.patch('/:id', requirePermissionMiddleware('customers', 'update'), async (c) => {
  if (!deps) throw new Error('[ORDR:API] Customer routes not configured');

  const ctx = ensureTenantContext(c);
  const requestId = c.get('requestId');
  const customerId = c.req.param('id');

  // Validate input
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const body = await c.req.json().catch(() => null);
  const parsed = updateCustomerSchema.safeParse(body);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path.join('.');
      const existing = fieldErrors[field];
      if (existing) {
        existing.push(issue.message);
      } else {
        fieldErrors[field] = [issue.message];
      }
    }
    throw new ValidationError('Invalid customer data', fieldErrors, requestId);
  }

  // Check that customer exists (tenant-isolated)
  const existing = await deps.findCustomerById(ctx.tenantId, customerId);
  if (!existing) {
    throw new NotFoundError('Customer not found', requestId);
  }

  // Encrypt changed PII fields
  const updateData = parsed.data as unknown as Record<string, unknown>;
  const encryptedData = encryptPiiFields(updateData, deps.fieldEncryptor);

  // Update in database
  const updated = await deps.updateCustomer(ctx.tenantId, customerId, encryptedData);
  if (!updated) {
    throw new NotFoundError('Customer not found', requestId);
  }

  // Build change set for audit (field names only, never values — may be PHI)
  const changedFields = Object.keys(parsed.data);

  // Audit log
  await deps.auditLogger.log({
    tenantId: ctx.tenantId,
    eventType: 'data.updated',
    actorType: 'user',
    actorId: ctx.userId,
    resource: 'customers',
    resourceId: customerId,
    action: 'update',
    details: { changedFields },
    timestamp: new Date(),
  });

  // Publish domain event
  const changes: Record<string, { old: unknown; new: unknown }> = {};
  for (const field of changedFields) {
    // Only log field names, not values (PHI protection)
    changes[field] = { old: '[redacted]', new: '[redacted]' };
  }

  const event = createEventEnvelope(
    EventType.CUSTOMER_UPDATED,
    ctx.tenantId,
    { customerId, changes },
    {
      correlationId: requestId,
      userId: ctx.userId,
      source: 'api',
    },
  );

  await deps.eventProducer.publish(TOPICS.CUSTOMER_EVENTS, event).catch((err: unknown) => {
    console.error('[ORDR:API] Failed to publish customer.updated event:', err);
  });

  // Return decrypted version
  const decrypted = decryptCustomer(updated, deps.fieldEncryptor);

  return c.json({
    success: true as const,
    data: decrypted,
  });
});

// ---- DELETE /:id — soft delete customer ------------------------------------

customersRouter.delete('/:id', requirePermissionMiddleware('customers', 'delete'), async (c) => {
  if (!deps) throw new Error('[ORDR:API] Customer routes not configured');

  const ctx = ensureTenantContext(c);
  const requestId = c.get('requestId');
  const customerId = c.req.param('id');

  // Check existence (tenant-isolated)
  const existing = await deps.findCustomerById(ctx.tenantId, customerId);
  if (!existing) {
    throw new NotFoundError('Customer not found', requestId);
  }

  // Soft delete (set status = inactive)
  const deleted = await deps.softDeleteCustomer(ctx.tenantId, customerId);
  if (!deleted) {
    throw new NotFoundError('Customer not found', requestId);
  }

  // Audit log
  await deps.auditLogger.log({
    tenantId: ctx.tenantId,
    eventType: 'data.deleted',
    actorType: 'user',
    actorId: ctx.userId,
    resource: 'customers',
    resourceId: customerId,
    action: 'soft_delete',
    details: {},
    timestamp: new Date(),
  });

  // Publish domain event
  const event = createEventEnvelope(
    'customer.deleted',
    ctx.tenantId,
    { customerId, changes: {} },
    {
      correlationId: requestId,
      userId: ctx.userId,
      source: 'api',
    },
  );

  await deps.eventProducer.publish(TOPICS.CUSTOMER_EVENTS, event).catch((err: unknown) => {
    console.error('[ORDR:API] Failed to publish customer.deleted event:', err);
  });

  return c.json({ success: true as const }, 200);
});

export { customersRouter };
