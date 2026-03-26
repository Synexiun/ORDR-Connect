/**
 * Route Metadata Registry — declarative API route documentation
 *
 * SOC2 CC1.4 — Documentation: every endpoint's auth, rate limits, and errors documented.
 * ISO 27001 A.12.1.1 — Documented operating procedures.
 *
 * Provides a central registry for all route metadata used to generate
 * the OpenAPI 3.1 specification.
 */

// ---- Types ------------------------------------------------------------------

export interface RouteMetadata {
  readonly path: string;
  readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  readonly summary: string;
  readonly description: string;
  readonly tags: readonly string[];
  readonly auth: 'required' | 'optional' | 'none';
  readonly rateLimit: number;
  readonly requestSchema?: string | undefined;
  readonly responseSchema?: string | undefined;
  readonly errors: readonly number[];
}

// ---- Registry ---------------------------------------------------------------

export class RouteRegistry {
  private readonly routes: RouteMetadata[] = [];

  register(meta: RouteMetadata): void {
    this.routes.push(meta);
  }

  getAll(): readonly RouteMetadata[] {
    return [...this.routes];
  }

  getByTag(tag: string): readonly RouteMetadata[] {
    return this.routes.filter((r) => r.tags.includes(tag));
  }
}

// ---- Default Registry with all routes ---------------------------------------

export function createDefaultRegistry(): RouteRegistry {
  const registry = new RouteRegistry();

  // ── Customers ────────────────────────────────────────────────────

  registry.register({
    path: '/api/v1/customers',
    method: 'GET',
    summary: 'List customers',
    description: 'Paginated list of customers with optional filters. PII fields are decrypted for authorized users.',
    tags: ['customers'],
    auth: 'required',
    rateLimit: 100,
    requestSchema: 'ListCustomersQuery',
    responseSchema: 'CustomerListResponse',
    errors: [400, 401, 403, 429],
  });

  registry.register({
    path: '/api/v1/customers/{id}',
    method: 'GET',
    summary: 'Get customer by ID',
    description: 'Retrieve a single customer by UUID. PII fields are decrypted for authorized users.',
    tags: ['customers'],
    auth: 'required',
    rateLimit: 100,
    responseSchema: 'CustomerResponse',
    errors: [401, 403, 404, 429],
  });

  registry.register({
    path: '/api/v1/customers',
    method: 'POST',
    summary: 'Create customer',
    description: 'Create a new customer. PII fields are encrypted before storage. Publishes customer.created event.',
    tags: ['customers'],
    auth: 'required',
    rateLimit: 50,
    requestSchema: 'CreateCustomerRequest',
    responseSchema: 'CustomerResponse',
    errors: [400, 401, 403, 409, 429],
  });

  registry.register({
    path: '/api/v1/customers/{id}',
    method: 'PATCH',
    summary: 'Update customer',
    description: 'Partially update a customer. PII fields are re-encrypted. Publishes customer.updated event.',
    tags: ['customers'],
    auth: 'required',
    rateLimit: 50,
    requestSchema: 'UpdateCustomerRequest',
    responseSchema: 'CustomerResponse',
    errors: [400, 401, 403, 404, 429],
  });

  registry.register({
    path: '/api/v1/customers/{id}',
    method: 'DELETE',
    summary: 'Soft-delete customer',
    description: 'Soft-delete a customer by setting status to inactive. Publishes customer.deleted event.',
    tags: ['customers'],
    auth: 'required',
    rateLimit: 20,
    responseSchema: 'SuccessResponse',
    errors: [401, 403, 404, 429],
  });

  // ── Agents ───────────────────────────────────────────────────────

  registry.register({
    path: '/api/v1/agents/sessions',
    method: 'GET',
    summary: 'List agent sessions',
    description: 'List active and recent agent sessions with pagination.',
    tags: ['agents'],
    auth: 'required',
    rateLimit: 100,
    responseSchema: 'AgentSessionListResponse',
    errors: [401, 403, 429],
  });

  registry.register({
    path: '/api/v1/agents/sessions',
    method: 'POST',
    summary: 'Create agent session',
    description: 'Start a new agent session for a specific customer. Requires human-in-the-loop approval for financial or PHI actions.',
    tags: ['agents'],
    auth: 'required',
    rateLimit: 20,
    requestSchema: 'CreateAgentSessionRequest',
    responseSchema: 'AgentSessionResponse',
    errors: [400, 401, 403, 429],
  });

  registry.register({
    path: '/api/v1/agents/sessions/{id}/kill',
    method: 'POST',
    summary: 'Kill agent session',
    description: 'Immediately terminate an agent session. Kill switch per Rule 9.',
    tags: ['agents'],
    auth: 'required',
    rateLimit: 50,
    responseSchema: 'SuccessResponse',
    errors: [401, 403, 404, 429],
  });

  registry.register({
    path: '/api/v1/agents/hitl-queue',
    method: 'GET',
    summary: 'List HITL queue items',
    description: 'Retrieve pending human-in-the-loop review items.',
    tags: ['agents'],
    auth: 'required',
    rateLimit: 100,
    responseSchema: 'HitlQueueResponse',
    errors: [401, 403, 429],
  });

  registry.register({
    path: '/api/v1/agents/hitl-queue/{id}/approve',
    method: 'POST',
    summary: 'Approve HITL item',
    description: 'Approve a human-in-the-loop review item, allowing the agent to proceed.',
    tags: ['agents'],
    auth: 'required',
    rateLimit: 50,
    responseSchema: 'SuccessResponse',
    errors: [401, 403, 404, 429],
  });

  registry.register({
    path: '/api/v1/agents/hitl-queue/{id}/reject',
    method: 'POST',
    summary: 'Reject HITL item',
    description: 'Reject a human-in-the-loop review item, blocking the agent action.',
    tags: ['agents'],
    auth: 'required',
    rateLimit: 50,
    responseSchema: 'SuccessResponse',
    errors: [401, 403, 404, 429],
  });

  // ── Messages ─────────────────────────────────────────────────────

  registry.register({
    path: '/api/v1/messages',
    method: 'GET',
    summary: 'List messages',
    description: 'List messages with metadata only (no content). Paginated, tenant-scoped.',
    tags: ['messages'],
    auth: 'required',
    rateLimit: 100,
    responseSchema: 'MessageListResponse',
    errors: [401, 403, 429],
  });

  registry.register({
    path: '/api/v1/messages/{id}',
    method: 'GET',
    summary: 'Get message by ID',
    description: 'Retrieve a single message with metadata.',
    tags: ['messages'],
    auth: 'required',
    rateLimit: 100,
    responseSchema: 'MessageResponse',
    errors: [401, 403, 404, 429],
  });

  registry.register({
    path: '/api/v1/messages/send',
    method: 'POST',
    summary: 'Send message',
    description: 'Send a message via the specified channel (SMS, email, WhatsApp). Content is compliance-checked before delivery.',
    tags: ['messages'],
    auth: 'required',
    rateLimit: 20,
    requestSchema: 'SendMessageRequest',
    responseSchema: 'MessageResponse',
    errors: [400, 401, 403, 429, 451],
  });

  // ── Webhooks ─────────────────────────────────────────────────────

  registry.register({
    path: '/api/v1/webhooks/twilio/sms',
    method: 'POST',
    summary: 'Twilio SMS webhook',
    description: 'Receives inbound SMS events from Twilio. Authenticated via Twilio signature validation, not JWT.',
    tags: ['webhooks'],
    auth: 'none',
    rateLimit: 1000,
    errors: [400, 403],
  });

  registry.register({
    path: '/api/v1/webhooks/twilio/voice',
    method: 'POST',
    summary: 'Twilio Voice webhook',
    description: 'Receives voice call events from Twilio Programmable Voice.',
    tags: ['webhooks'],
    auth: 'none',
    rateLimit: 1000,
    errors: [400, 403],
  });

  registry.register({
    path: '/api/v1/webhooks/twilio/whatsapp',
    method: 'POST',
    summary: 'Twilio WhatsApp webhook',
    description: 'Receives WhatsApp message events from Twilio WhatsApp Business API.',
    tags: ['webhooks'],
    auth: 'none',
    rateLimit: 1000,
    errors: [400, 403],
  });

  registry.register({
    path: '/api/v1/webhooks/sendgrid',
    method: 'POST',
    summary: 'SendGrid event webhook',
    description: 'Receives email delivery events from SendGrid.',
    tags: ['webhooks'],
    auth: 'none',
    rateLimit: 1000,
    errors: [400, 403],
  });

  // ── Analytics ────────────────────────────────────────────────────

  registry.register({
    path: '/api/v1/analytics/summary',
    method: 'GET',
    summary: 'Dashboard summary',
    description: 'Returns aggregated dashboard metrics: active customers, messages sent, agent sessions, compliance score.',
    tags: ['analytics'],
    auth: 'required',
    rateLimit: 60,
    responseSchema: 'AnalyticsSummaryResponse',
    errors: [401, 403, 429],
  });

  registry.register({
    path: '/api/v1/analytics/trends/{metric}',
    method: 'GET',
    summary: 'Metric trends',
    description: 'Returns time-series trend data for the specified metric.',
    tags: ['analytics'],
    auth: 'required',
    rateLimit: 60,
    responseSchema: 'TrendResponse',
    errors: [400, 401, 403, 429],
  });

  registry.register({
    path: '/api/v1/analytics/real-time',
    method: 'GET',
    summary: 'Real-time counters',
    description: 'Returns live counters for active sessions, pending messages, and queue depth.',
    tags: ['analytics'],
    auth: 'required',
    rateLimit: 120,
    responseSchema: 'RealTimeCountersResponse',
    errors: [401, 403, 429],
  });

  // ── SSO ──────────────────────────────────────────────────────────

  registry.register({
    path: '/api/v1/sso/connections',
    method: 'GET',
    summary: 'List SSO connections',
    description: 'List configured SSO connections for the tenant.',
    tags: ['sso'],
    auth: 'required',
    rateLimit: 60,
    responseSchema: 'SsoConnectionListResponse',
    errors: [401, 403, 429],
  });

  registry.register({
    path: '/api/v1/sso/connections',
    method: 'POST',
    summary: 'Create SSO connection',
    description: 'Configure a new SSO connection (SAML or OIDC).',
    tags: ['sso'],
    auth: 'required',
    rateLimit: 10,
    requestSchema: 'CreateSsoConnectionRequest',
    responseSchema: 'SsoConnectionResponse',
    errors: [400, 401, 403, 409, 429],
  });

  // ── Organizations ────────────────────────────────────────────────

  registry.register({
    path: '/api/v1/organizations',
    method: 'GET',
    summary: 'List organizations',
    description: 'List organizations within the tenant hierarchy.',
    tags: ['organizations'],
    auth: 'required',
    rateLimit: 60,
    responseSchema: 'OrganizationListResponse',
    errors: [401, 403, 429],
  });

  registry.register({
    path: '/api/v1/organizations',
    method: 'POST',
    summary: 'Create organization',
    description: 'Create a new organization in the tenant hierarchy.',
    tags: ['organizations'],
    auth: 'required',
    rateLimit: 20,
    requestSchema: 'CreateOrganizationRequest',
    responseSchema: 'OrganizationResponse',
    errors: [400, 401, 403, 409, 429],
  });

  // ── Roles ────────────────────────────────────────────────────────

  registry.register({
    path: '/api/v1/roles',
    method: 'GET',
    summary: 'List custom roles',
    description: 'List all custom roles defined for the tenant.',
    tags: ['roles'],
    auth: 'required',
    rateLimit: 60,
    responseSchema: 'RoleListResponse',
    errors: [401, 403, 429],
  });

  registry.register({
    path: '/api/v1/roles',
    method: 'POST',
    summary: 'Create custom role',
    description: 'Create a new custom role extending a built-in role with additional permissions.',
    tags: ['roles'],
    auth: 'required',
    rateLimit: 20,
    requestSchema: 'CreateRoleRequest',
    responseSchema: 'RoleResponse',
    errors: [400, 401, 403, 409, 429],
  });

  registry.register({
    path: '/api/v1/roles/{id}',
    method: 'PATCH',
    summary: 'Update custom role',
    description: 'Update an existing custom role.',
    tags: ['roles'],
    auth: 'required',
    rateLimit: 20,
    requestSchema: 'UpdateRoleRequest',
    responseSchema: 'RoleResponse',
    errors: [400, 401, 403, 404, 429],
  });

  registry.register({
    path: '/api/v1/roles/{id}',
    method: 'DELETE',
    summary: 'Delete custom role',
    description: 'Delete a custom role. Users assigned this role revert to their base role.',
    tags: ['roles'],
    auth: 'required',
    rateLimit: 10,
    responseSchema: 'SuccessResponse',
    errors: [401, 403, 404, 429],
  });

  registry.register({
    path: '/api/v1/roles/{id}/assign',
    method: 'POST',
    summary: 'Assign role to user',
    description: 'Assign a custom role to a specific user within the tenant.',
    tags: ['roles'],
    auth: 'required',
    rateLimit: 20,
    requestSchema: 'AssignRoleRequest',
    responseSchema: 'SuccessResponse',
    errors: [400, 401, 403, 404, 429],
  });

  registry.register({
    path: '/api/v1/roles/{id}/revoke',
    method: 'POST',
    summary: 'Revoke role from user',
    description: 'Revoke a custom role from a specific user within the tenant.',
    tags: ['roles'],
    auth: 'required',
    rateLimit: 20,
    requestSchema: 'RevokeRoleRequest',
    responseSchema: 'SuccessResponse',
    errors: [400, 401, 403, 404, 429],
  });

  // ── Compliance ───────────────────────────────────────────────────

  registry.register({
    path: '/api/v1/compliance/status',
    method: 'GET',
    summary: 'Compliance status',
    description: 'Returns current compliance posture across SOC2, ISO27001, and HIPAA controls.',
    tags: ['compliance'],
    auth: 'required',
    rateLimit: 30,
    responseSchema: 'ComplianceStatusResponse',
    errors: [401, 403, 429],
  });

  // ── Branding ─────────────────────────────────────────────────────

  registry.register({
    path: '/api/v1/branding',
    method: 'GET',
    summary: 'Get branding config',
    description: 'Retrieve white-label branding configuration for the tenant.',
    tags: ['branding'],
    auth: 'required',
    rateLimit: 60,
    responseSchema: 'BrandingResponse',
    errors: [401, 403, 429],
  });

  registry.register({
    path: '/api/v1/branding',
    method: 'PUT',
    summary: 'Update branding config',
    description: 'Update white-label branding configuration.',
    tags: ['branding'],
    auth: 'required',
    rateLimit: 10,
    requestSchema: 'UpdateBrandingRequest',
    responseSchema: 'BrandingResponse',
    errors: [400, 401, 403, 429],
  });

  return registry;
}
