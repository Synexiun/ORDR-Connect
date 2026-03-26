/**
 * OpenAPI 3.1 Spec Generator — produces a full specification from route metadata
 *
 * SOC2 CC1.4 — Documentation: auto-generated, always-current API docs.
 * ISO 27001 A.12.1.1 — Documented operating procedures.
 *
 * Generates a JSON-serializable OpenAPI 3.1.0 document from the RouteRegistry.
 * Includes security schemes, tags, error schemas, and all registered routes.
 */

import type { RouteRegistry, RouteMetadata } from './metadata.js';

// ---- OpenAPI Types (JSON-serializable subset) --------------------------------

export interface OpenAPIDocument {
  readonly openapi: '3.1.0';
  readonly info: {
    readonly title: string;
    readonly version: string;
    readonly description: string;
    readonly contact: {
      readonly name: string;
      readonly email: string;
    };
    readonly license: {
      readonly name: string;
    };
  };
  readonly servers: ReadonlyArray<{
    readonly url: string;
    readonly description: string;
  }>;
  readonly paths: Record<string, Record<string, OpenAPIOperation>>;
  readonly components: {
    readonly securitySchemes: Record<string, OpenAPISecurityScheme>;
    readonly schemas: Record<string, OpenAPISchema>;
  };
  readonly tags: ReadonlyArray<{
    readonly name: string;
    readonly description: string;
  }>;
  readonly security: ReadonlyArray<Record<string, readonly string[]>>;
}

interface OpenAPIOperation {
  readonly operationId: string;
  readonly summary: string;
  readonly description: string;
  readonly tags: readonly string[];
  readonly security?: ReadonlyArray<Record<string, readonly string[]>> | undefined;
  readonly parameters?: readonly OpenAPIParameter[] | undefined;
  readonly requestBody?: {
    readonly required: boolean;
    readonly content: {
      readonly 'application/json': {
        readonly schema: { readonly '$ref': string };
      };
    };
  } | undefined;
  readonly responses: Record<string, OpenAPIResponse>;
  readonly 'x-rate-limit'?: number | undefined;
}

interface OpenAPIParameter {
  readonly name: string;
  readonly in: 'path' | 'query' | 'header';
  readonly required: boolean;
  readonly schema: { readonly type: string };
  readonly description?: string | undefined;
}

interface OpenAPIResponse {
  readonly description: string;
  readonly content?: {
    readonly 'application/json': {
      readonly schema: { readonly '$ref': string };
    };
  } | undefined;
}

interface OpenAPISecurityScheme {
  readonly type: 'http' | 'apiKey';
  readonly scheme?: string | undefined;
  readonly bearerFormat?: string | undefined;
  readonly name?: string | undefined;
  readonly in?: string | undefined;
  readonly description: string;
}

interface OpenAPISchema {
  readonly type: string;
  readonly properties?: Record<string, unknown> | undefined;
  readonly required?: readonly string[] | undefined;
  readonly description?: string | undefined;
}

// ---- Tag metadata -----------------------------------------------------------

const TAG_DESCRIPTIONS: Readonly<Record<string, string>> = {
  customers: 'Customer lifecycle management with PHI encryption',
  agents: 'AI agent session management and human-in-the-loop controls',
  messages: 'Multi-channel message delivery (SMS, email, WhatsApp, voice)',
  webhooks: 'Inbound webhook endpoints for Twilio and SendGrid',
  analytics: 'Dashboard metrics, trends, and real-time counters',
  sso: 'Enterprise Single Sign-On (SAML/OIDC) configuration',
  organizations: 'Organization hierarchy management',
  roles: 'Custom RBAC role management and assignment',
  compliance: 'Compliance posture monitoring (SOC2, ISO27001, HIPAA)',
  branding: 'White-label branding and custom domain configuration',
} as const;

// ---- HTTP status code descriptions ------------------------------------------

const HTTP_STATUS_DESCRIPTIONS: Readonly<Record<number, string>> = {
  200: 'Successful operation',
  201: 'Resource created successfully',
  204: 'No content',
  400: 'Validation error — check request body/parameters',
  401: 'Authentication required — provide valid Bearer token or API key',
  403: 'Insufficient permissions for this operation',
  404: 'Resource not found',
  409: 'Resource conflict — duplicate or version mismatch',
  429: 'Rate limit exceeded — retry after cooldown',
  451: 'Compliance violation — action blocked by regulatory rules',
  500: 'Internal server error — contact support with correlation ID',
} as const;

// ---- Generator --------------------------------------------------------------

function extractPathParams(path: string): readonly OpenAPIParameter[] {
  const params: OpenAPIParameter[] = [];
  const regex = /\{(\w+)\}/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(path)) !== null) {
    const paramName = match[1];
    if (paramName) {
      params.push({
        name: paramName,
        in: 'path',
        required: true,
        schema: { type: 'string' },
        description: `${paramName} identifier (UUID)`,
      });
    }
  }

  return params;
}

function toOperationId(method: string, path: string): string {
  const segments = path
    .replace(/^\/api\/v1\//, '')
    .replace(/\{(\w+)\}/g, 'By$1')
    .split('/')
    .filter(Boolean);

  const methodPrefix = method.toLowerCase();
  const pathPart = segments
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join('');

  return `${methodPrefix}${pathPart}`;
}

function buildResponsesMap(meta: RouteMetadata): Record<string, OpenAPIResponse> {
  const responses: Record<string, OpenAPIResponse> = {};

  // Success response
  const successCode = meta.method === 'POST' ? '201' : '200';
  if (meta.responseSchema) {
    responses[successCode] = {
      description: HTTP_STATUS_DESCRIPTIONS[meta.method === 'POST' ? 201 : 200] ?? 'Success',
      content: {
        'application/json': {
          schema: { '$ref': `#/components/schemas/${meta.responseSchema}` },
        },
      },
    };
  } else {
    responses[successCode] = {
      description: HTTP_STATUS_DESCRIPTIONS[meta.method === 'POST' ? 201 : 200] ?? 'Success',
    };
  }

  // Error responses
  for (const code of meta.errors) {
    responses[String(code)] = {
      description: HTTP_STATUS_DESCRIPTIONS[code] ?? `Error ${String(code)}`,
      content: {
        'application/json': {
          schema: { '$ref': '#/components/schemas/ErrorResponse' },
        },
      },
    };
  }

  return responses;
}

function buildOperation(meta: RouteMetadata): OpenAPIOperation {
  const operation: {
    operationId: string;
    summary: string;
    description: string;
    tags: readonly string[];
    security?: ReadonlyArray<Record<string, readonly string[]>>;
    parameters?: readonly OpenAPIParameter[];
    requestBody?: {
      readonly required: boolean;
      readonly content: {
        readonly 'application/json': {
          readonly schema: { readonly '$ref': string };
        };
      };
    };
    responses: Record<string, OpenAPIResponse>;
    'x-rate-limit'?: number;
  } = {
    operationId: toOperationId(meta.method, meta.path),
    summary: meta.summary,
    description: meta.description,
    tags: [...meta.tags],
    responses: buildResponsesMap(meta),
  };

  // Security
  if (meta.auth === 'none') {
    operation.security = [];
  } else if (meta.auth === 'optional') {
    operation.security = [
      {},
      { BearerAuth: [] },
      { ApiKeyAuth: [] },
    ];
  }
  // 'required' uses the global security setting

  // Path parameters
  const pathParams = extractPathParams(meta.path);
  if (pathParams.length > 0) {
    operation.parameters = pathParams;
  }

  // Request body
  if (meta.requestSchema) {
    operation.requestBody = {
      required: true,
      content: {
        'application/json': {
          schema: { '$ref': `#/components/schemas/${meta.requestSchema}` },
        },
      },
    };
  }

  // Rate limit extension
  if (meta.rateLimit > 0) {
    operation['x-rate-limit'] = meta.rateLimit;
  }

  return operation;
}

/**
 * Generates a full OpenAPI 3.1.0 specification from the route registry.
 * Returns a plain JSON-serializable object (no class instances, no functions).
 */
export function generateOpenAPISpec(registry: RouteRegistry): OpenAPIDocument {
  const routes = registry.getAll();

  // Build paths
  const paths: Record<string, Record<string, OpenAPIOperation>> = {};
  for (const meta of routes) {
    const existing = paths[meta.path] ?? {};
    existing[meta.method.toLowerCase()] = buildOperation(meta);
    paths[meta.path] = existing;
  }

  // Collect unique tags
  const tagSet = new Set<string>();
  for (const meta of routes) {
    for (const tag of meta.tags) {
      tagSet.add(tag);
    }
  }

  const tags = [...tagSet]
    .sort()
    .map((name) => ({
      name,
      description: TAG_DESCRIPTIONS[name] ?? name,
    }));

  return {
    openapi: '3.1.0',
    info: {
      title: 'ORDR-Connect API',
      version: '1.0.0',
      description: 'Customer Operations OS API — event-sourced, multi-agent platform with SOC2/ISO27001/HIPAA compliance.',
      contact: {
        name: 'ORDR-Connect Engineering',
        email: 'api@ordr-connect.dev',
      },
      license: {
        name: 'Proprietary',
      },
    },
    servers: [
      {
        url: 'https://api.ordr-connect.dev',
        description: 'Production',
      },
      {
        url: 'https://staging-api.ordr-connect.dev',
        description: 'Staging',
      },
      {
        url: 'http://localhost:3000',
        description: 'Local development',
      },
    ],
    paths,
    components: {
      securitySchemes: {
        BearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'JWT access token obtained via /api/v1/auth/login. Required for most endpoints.',
        },
        ApiKeyAuth: {
          type: 'apiKey',
          name: 'X-API-Key',
          in: 'header',
          description: 'API key for programmatic access. SHA-256 hashed at rest.',
        },
      },
      schemas: {
        ErrorResponse: {
          type: 'object',
          description: 'Standard error response with correlation ID for support reference.',
          properties: {
            success: { type: 'boolean', const: false },
            error: {
              type: 'object',
              properties: {
                code: { type: 'string', description: 'Machine-readable error code' },
                message: { type: 'string', description: 'Human-readable error description' },
                correlationId: { type: 'string', format: 'uuid', description: 'Unique request ID for support' },
              },
              required: ['code', 'message', 'correlationId'],
            },
          },
          required: ['success', 'error'],
        },
        SuccessResponse: {
          type: 'object',
          description: 'Generic success response.',
          properties: {
            success: { type: 'boolean', const: true },
          },
          required: ['success'],
        },
        PaginationMeta: {
          type: 'object',
          description: 'Pagination metadata included in list responses.',
          properties: {
            page: { type: 'integer', minimum: 1 },
            pageSize: { type: 'integer', minimum: 1, maximum: 100 },
            total: { type: 'integer', minimum: 0 },
            totalPages: { type: 'integer', minimum: 0 },
          },
          required: ['page', 'pageSize', 'total', 'totalPages'],
        },
      },
    },
    tags,
    security: [
      { BearerAuth: [] },
      { ApiKeyAuth: [] },
    ],
  };
}
