/**
 * OpenAPI Specification Route — programmatic OpenAPI 3.1 spec
 *
 * SOC2 CC2.1 — Communication: public API documentation for integrators.
 * ISO 27001 A.14.2.1 — Secure development: API contracts documented.
 *
 * Serves a static OpenAPI 3.1 spec object describing all public ORDR-Connect
 * API endpoints, security schemes, and request/response schemas.
 *
 * SECURITY:
 * - No authentication required (public documentation)
 * - No internal/admin endpoints exposed in spec
 * - No sensitive information in descriptions or examples
 */

import { Hono } from 'hono';
import type { Env } from '../types.js';

// ─── OpenAPI 3.1 Spec ──────────────────────────────────────────────

const OPENAPI_SPEC = {
  openapi: '3.1.0',
  info: {
    title: 'ORDR-Connect API',
    description: 'Customer Operations OS — autonomous, event-sourced, multi-agent platform. SOC2 + ISO27001 + HIPAA compliant.',
    version: '1.0.0',
    contact: {
      name: 'ORDR-Connect Developer Support',
      url: 'https://developers.ordr-connect.com',
      email: 'developers@ordr-connect.com',
    },
    license: {
      name: 'Proprietary',
    },
  },
  servers: [
    {
      url: 'https://api.ordr-connect.com',
      description: 'Production',
    },
    {
      url: 'https://sandbox.api.ordr-connect.com',
      description: 'Sandbox',
    },
  ],
  security: [
    { bearerAuth: [] },
    { apiKeyAuth: [] },
  ],
  paths: {
    '/api/v1/auth/login': {
      post: {
        tags: ['Authentication'],
        summary: 'Authenticate user',
        description: 'Authenticates a user with email and password, returns JWT access and refresh tokens.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                  email: { type: 'string', format: 'email' },
                  password: { type: 'string', minLength: 12 },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Authentication successful' },
          '401': { description: 'Invalid credentials' },
          '429': { description: 'Rate limit exceeded' },
        },
      },
    },
    '/api/v1/auth/refresh': {
      post: {
        tags: ['Authentication'],
        summary: 'Refresh access token',
        description: 'Exchanges a refresh token for a new access token.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['refreshToken'],
                properties: {
                  refreshToken: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Token refreshed' },
          '401': { description: 'Invalid refresh token' },
        },
      },
    },
    '/api/v1/auth/me': {
      get: {
        tags: ['Authentication'],
        summary: 'Get current user profile',
        responses: {
          '200': { description: 'User profile' },
          '401': { description: 'Not authenticated' },
        },
      },
    },
    '/api/v1/customers': {
      get: {
        tags: ['Customers'],
        summary: 'List customers',
        description: 'Returns a paginated list of customers scoped to the authenticated tenant.',
        parameters: [
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'pageSize', in: 'query', schema: { type: 'integer', default: 20 } },
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['active', 'inactive', 'churned'] } },
          { name: 'type', in: 'query', schema: { type: 'string', enum: ['individual', 'company'] } },
          { name: 'search', in: 'query', schema: { type: 'string' } },
        ],
        responses: {
          '200': { description: 'Customer list with pagination' },
          '401': { description: 'Not authenticated' },
        },
      },
      post: {
        tags: ['Customers'],
        summary: 'Create customer',
        description: 'Creates a new customer record. PII fields are encrypted at rest.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['type', 'name'],
                properties: {
                  type: { type: 'string', enum: ['individual', 'company'] },
                  name: { type: 'string' },
                  email: { type: 'string', format: 'email' },
                  phone: { type: 'string' },
                  metadata: { type: 'object' },
                },
              },
            },
          },
        },
        responses: {
          '201': { description: 'Customer created' },
          '400': { description: 'Validation error' },
          '401': { description: 'Not authenticated' },
        },
      },
    },
    '/api/v1/customers/{id}': {
      get: {
        tags: ['Customers'],
        summary: 'Get customer by ID',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          '200': { description: 'Customer details' },
          '404': { description: 'Customer not found' },
        },
      },
      patch: {
        tags: ['Customers'],
        summary: 'Update customer',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          '200': { description: 'Customer updated' },
          '400': { description: 'Validation error' },
          '404': { description: 'Customer not found' },
        },
      },
      delete: {
        tags: ['Customers'],
        summary: 'Soft delete customer',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          '200': { description: 'Customer deleted' },
          '404': { description: 'Customer not found' },
        },
      },
    },
    '/api/v1/messages': {
      get: {
        tags: ['Messages'],
        summary: 'List messages',
        description: 'Returns message metadata (no content bodies) for the authenticated tenant.',
        responses: {
          '200': { description: 'Message list' },
          '401': { description: 'Not authenticated' },
        },
      },
    },
    '/api/v1/analytics/overview': {
      get: {
        tags: ['Analytics'],
        summary: 'Analytics overview',
        description: 'Returns real-time operational analytics for the authenticated tenant.',
        responses: {
          '200': { description: 'Analytics data' },
          '401': { description: 'Not authenticated' },
        },
      },
    },
    '/api/v1/agents': {
      get: {
        tags: ['Agents'],
        summary: 'List agent sessions',
        description: 'Returns active and recent agent sessions for the tenant.',
        responses: {
          '200': { description: 'Agent session list' },
          '401': { description: 'Not authenticated' },
        },
      },
    },
    '/api/v1/developers/register': {
      post: {
        tags: ['Developer Portal'],
        summary: 'Register developer account',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'name', 'password'],
                properties: {
                  email: { type: 'string', format: 'email' },
                  name: { type: 'string' },
                  password: { type: 'string', minLength: 12 },
                  tier: { type: 'string', enum: ['free', 'pro', 'enterprise'], default: 'free' },
                  organization: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '201': { description: 'Developer account created' },
          '400': { description: 'Validation error' },
          '409': { description: 'Email already registered' },
        },
      },
    },
    '/api/v1/developers/login': {
      post: {
        tags: ['Developer Portal'],
        summary: 'Authenticate developer',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                  email: { type: 'string', format: 'email' },
                  password: { type: 'string', minLength: 12 },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Authentication successful' },
          '401': { description: 'Invalid credentials' },
        },
      },
    },
    '/api/v1/developers/me': {
      get: {
        tags: ['Developer Portal'],
        summary: 'Get developer profile',
        responses: {
          '200': { description: 'Developer profile' },
          '401': { description: 'Not authenticated' },
        },
      },
    },
    '/api/v1/developers/keys': {
      get: {
        tags: ['Developer Portal'],
        summary: 'List API keys',
        description: 'Returns API key metadata (prefix only, never the full key).',
        responses: {
          '200': { description: 'API key list' },
          '401': { description: 'Not authenticated' },
        },
      },
      post: {
        tags: ['Developer Portal'],
        summary: 'Create API key',
        description: 'Generates a new API key. The raw key is returned once and never stored.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name'],
                properties: {
                  name: { type: 'string' },
                  expiresInDays: { type: 'integer', minimum: 1, maximum: 365 },
                },
              },
            },
          },
        },
        responses: {
          '201': { description: 'API key created (raw key in response)' },
          '400': { description: 'Validation error' },
          '401': { description: 'Not authenticated' },
        },
      },
    },
    '/api/v1/developers/keys/{keyId}': {
      delete: {
        tags: ['Developer Portal'],
        summary: 'Revoke API key',
        parameters: [
          { name: 'keyId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          '200': { description: 'API key revoked' },
          '404': { description: 'API key not found' },
          '401': { description: 'Not authenticated' },
        },
      },
    },
    '/api/v1/developers/sandbox': {
      get: {
        tags: ['Developer Portal'],
        summary: 'List sandbox tenants',
        responses: {
          '200': { description: 'Sandbox list' },
          '401': { description: 'Not authenticated' },
        },
      },
      post: {
        tags: ['Developer Portal'],
        summary: 'Provision sandbox tenant',
        description: 'Creates a sandbox tenant with optional seed data. Limits enforced per tier.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name'],
                properties: {
                  name: { type: 'string' },
                  seedProfile: { type: 'string', enum: ['minimal', 'collections', 'healthcare'], default: 'minimal' },
                },
              },
            },
          },
        },
        responses: {
          '201': { description: 'Sandbox provisioned' },
          '400': { description: 'Validation error or tier limit reached' },
          '401': { description: 'Not authenticated' },
        },
      },
    },
    '/api/v1/developers/sandbox/{sandboxId}': {
      delete: {
        tags: ['Developer Portal'],
        summary: 'Destroy sandbox tenant',
        parameters: [
          { name: 'sandboxId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          '200': { description: 'Sandbox destroyed' },
          '404': { description: 'Sandbox not found' },
          '401': { description: 'Not authenticated' },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http' as const,
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'RS256 JWT access token obtained from /api/v1/auth/login',
      },
      apiKeyAuth: {
        type: 'apiKey' as const,
        in: 'header' as const,
        name: 'Authorization',
        description: 'API key with "Bearer ordr_" prefix (e.g., "Bearer ordr_abc123...")',
      },
    },
  },
  tags: [
    { name: 'Authentication', description: 'User authentication and session management' },
    { name: 'Customers', description: 'Customer CRUD with PII encryption' },
    { name: 'Messages', description: 'Multi-channel message management' },
    { name: 'Analytics', description: 'Real-time operational analytics' },
    { name: 'Agents', description: 'AI agent session management' },
    { name: 'Developer Portal', description: 'Developer account, API key, and sandbox management' },
  ],
} as const;

// ─── Router ─────────────────────────────────────────────────────────

const openapiRouter = new Hono<Env>();

/**
 * GET /openapi.json — Returns the full OpenAPI 3.1 specification.
 *
 * No authentication required — this is public developer documentation.
 * Content-Type is set to application/json explicitly.
 */
openapiRouter.get('/', (c) => {
  c.header('Content-Type', 'application/json');
  c.header('Cache-Control', 'public, max-age=3600');
  return c.json(OPENAPI_SPEC);
});

export { openapiRouter, OPENAPI_SPEC };
