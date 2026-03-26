/**
 * OpenAPI Spec Generation Tests — route metadata and spec generator
 *
 * Tests that:
 * - RouteRegistry stores and retrieves metadata correctly
 * - Default registry includes all route groups
 * - Generated spec is valid OpenAPI 3.1
 * - Security schemes, tags, and error schemas are present
 * - All registered routes appear in the spec
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  RouteRegistry,
  createDefaultRegistry,
} from '../openapi/metadata.js';
import type { RouteMetadata } from '../openapi/metadata.js';
import { generateOpenAPISpec } from '../openapi/spec-generator.js';
import type { OpenAPIDocument } from '../openapi/spec-generator.js';

// ── RouteRegistry Tests ──────────────────────────────────────────

describe('RouteRegistry', () => {
  let registry: RouteRegistry;

  beforeEach(() => {
    registry = new RouteRegistry();
  });

  it('starts empty', () => {
    expect(registry.getAll()).toEqual([]);
  });

  it('registers a single route', () => {
    const meta: RouteMetadata = {
      path: '/test',
      method: 'GET',
      summary: 'Test route',
      description: 'A test route',
      tags: ['test'],
      auth: 'required',
      rateLimit: 100,
      errors: [401, 403],
    };

    registry.register(meta);
    expect(registry.getAll()).toHaveLength(1);
    expect(registry.getAll()[0]).toEqual(meta);
  });

  it('registers multiple routes', () => {
    registry.register({
      path: '/a', method: 'GET', summary: 'A', description: 'A',
      tags: ['a'], auth: 'required', rateLimit: 100, errors: [],
    });
    registry.register({
      path: '/b', method: 'POST', summary: 'B', description: 'B',
      tags: ['b'], auth: 'none', rateLimit: 50, errors: [400],
    });

    expect(registry.getAll()).toHaveLength(2);
  });

  it('filters routes by tag', () => {
    registry.register({
      path: '/a', method: 'GET', summary: 'A', description: 'A',
      tags: ['alpha', 'common'], auth: 'required', rateLimit: 100, errors: [],
    });
    registry.register({
      path: '/b', method: 'POST', summary: 'B', description: 'B',
      tags: ['beta'], auth: 'none', rateLimit: 50, errors: [],
    });
    registry.register({
      path: '/c', method: 'GET', summary: 'C', description: 'C',
      tags: ['alpha'], auth: 'optional', rateLimit: 60, errors: [],
    });

    const alphaRoutes = registry.getByTag('alpha');
    expect(alphaRoutes).toHaveLength(2);

    const betaRoutes = registry.getByTag('beta');
    expect(betaRoutes).toHaveLength(1);

    const missingRoutes = registry.getByTag('nonexistent');
    expect(missingRoutes).toHaveLength(0);
  });

  it('getAll returns a copy (immutable)', () => {
    registry.register({
      path: '/test', method: 'GET', summary: 'T', description: 'T',
      tags: ['test'], auth: 'required', rateLimit: 100, errors: [],
    });

    const all1 = registry.getAll();
    const all2 = registry.getAll();
    expect(all1).not.toBe(all2); // Different array references
    expect(all1).toEqual(all2);  // Same content
  });
});

// ── Default Registry Tests ───────────────────────────────────────

describe('createDefaultRegistry', () => {
  let registry: RouteRegistry;

  beforeEach(() => {
    registry = createDefaultRegistry();
  });

  it('creates a non-empty registry', () => {
    expect(registry.getAll().length).toBeGreaterThan(0);
  });

  it('includes customer routes', () => {
    const routes = registry.getByTag('customers');
    expect(routes.length).toBeGreaterThanOrEqual(4); // GET, POST, PATCH, DELETE
  });

  it('includes agent routes', () => {
    const routes = registry.getByTag('agents');
    expect(routes.length).toBeGreaterThanOrEqual(2);
  });

  it('includes message routes', () => {
    const routes = registry.getByTag('messages');
    expect(routes.length).toBeGreaterThanOrEqual(2);
  });

  it('includes webhook routes', () => {
    const routes = registry.getByTag('webhooks');
    expect(routes.length).toBeGreaterThanOrEqual(2);
  });

  it('includes analytics routes', () => {
    const routes = registry.getByTag('analytics');
    expect(routes.length).toBeGreaterThanOrEqual(2);
  });

  it('includes SSO routes', () => {
    const routes = registry.getByTag('sso');
    expect(routes.length).toBeGreaterThanOrEqual(1);
  });

  it('includes organization routes', () => {
    const routes = registry.getByTag('organizations');
    expect(routes.length).toBeGreaterThanOrEqual(1);
  });

  it('includes role routes', () => {
    const routes = registry.getByTag('roles');
    expect(routes.length).toBeGreaterThanOrEqual(3);
  });

  it('includes compliance routes', () => {
    const routes = registry.getByTag('compliance');
    expect(routes.length).toBeGreaterThanOrEqual(1);
  });

  it('includes branding routes', () => {
    const routes = registry.getByTag('branding');
    expect(routes.length).toBeGreaterThanOrEqual(1);
  });

  it('all routes have required fields', () => {
    const routes = registry.getAll();
    for (const route of routes) {
      expect(route.path).toBeDefined();
      expect(route.method).toBeDefined();
      expect(route.summary).toBeDefined();
      expect(route.description).toBeDefined();
      expect(route.tags.length).toBeGreaterThan(0);
      expect(route.auth).toBeDefined();
      expect(typeof route.rateLimit).toBe('number');
      expect(Array.isArray(route.errors)).toBe(true);
    }
  });

  it('webhook routes have auth set to none', () => {
    const webhookRoutes = registry.getByTag('webhooks');
    for (const route of webhookRoutes) {
      expect(route.auth).toBe('none');
    }
  });
});

// ── Spec Generator Tests ─────────────────────────────────────────

describe('generateOpenAPISpec', () => {
  let spec: OpenAPIDocument;

  beforeEach(() => {
    const registry = createDefaultRegistry();
    spec = generateOpenAPISpec(registry);
  });

  it('produces OpenAPI 3.1.0 version', () => {
    expect(spec.openapi).toBe('3.1.0');
  });

  it('includes info block with title and version', () => {
    expect(spec.info.title).toBe('ORDR-Connect API');
    expect(spec.info.version).toBe('1.0.0');
    expect(spec.info.description).toBeDefined();
    expect(spec.info.description.length).toBeGreaterThan(0);
  });

  it('includes contact information', () => {
    expect(spec.info.contact.name).toBeDefined();
    expect(spec.info.contact.email).toBeDefined();
  });

  it('includes servers', () => {
    expect(spec.servers.length).toBeGreaterThanOrEqual(2);
    const urls = spec.servers.map((s) => s.url);
    expect(urls).toContain('https://api.ordr-connect.dev');
    expect(urls).toContain('http://localhost:3000');
  });

  it('includes BearerAuth security scheme', () => {
    expect(spec.components.securitySchemes).toHaveProperty('BearerAuth');
    expect(spec.components.securitySchemes['BearerAuth']!.type).toBe('http');
    expect(spec.components.securitySchemes['BearerAuth']!.scheme).toBe('bearer');
    expect(spec.components.securitySchemes['BearerAuth']!.bearerFormat).toBe('JWT');
  });

  it('includes ApiKeyAuth security scheme', () => {
    expect(spec.components.securitySchemes).toHaveProperty('ApiKeyAuth');
    expect(spec.components.securitySchemes['ApiKeyAuth']!.type).toBe('apiKey');
    expect(spec.components.securitySchemes['ApiKeyAuth']!.name).toBe('X-API-Key');
  });

  it('includes ErrorResponse schema', () => {
    expect(spec.components.schemas).toHaveProperty('ErrorResponse');
    const errSchema = spec.components.schemas['ErrorResponse']!;
    expect(errSchema.type).toBe('object');
  });

  it('includes SuccessResponse schema', () => {
    expect(spec.components.schemas).toHaveProperty('SuccessResponse');
  });

  it('includes PaginationMeta schema', () => {
    expect(spec.components.schemas).toHaveProperty('PaginationMeta');
  });

  it('generates paths from registry', () => {
    const pathKeys = Object.keys(spec.paths);
    expect(pathKeys.length).toBeGreaterThan(0);
    expect(pathKeys).toContain('/api/v1/customers');
    expect(pathKeys).toContain('/api/v1/customers/{id}');
  });

  it('generates correct operations for customer paths', () => {
    const customerPath = spec.paths['/api/v1/customers'];
    expect(customerPath).toBeDefined();
    expect(customerPath).toHaveProperty('get');
    expect(customerPath).toHaveProperty('post');
    expect(customerPath!['get']!.tags).toContain('customers');
    expect(customerPath!['post']!.tags).toContain('customers');
  });

  it('includes tags with descriptions', () => {
    expect(spec.tags.length).toBeGreaterThan(0);
    const tagNames = spec.tags.map((t) => t.name);
    expect(tagNames).toContain('customers');
    expect(tagNames).toContain('agents');
    expect(tagNames).toContain('webhooks');

    for (const tag of spec.tags) {
      expect(tag.description).toBeDefined();
      expect(tag.description.length).toBeGreaterThan(0);
    }
  });

  it('includes global security requirements', () => {
    expect(spec.security.length).toBeGreaterThan(0);
  });

  it('webhook operations have empty security (unauthenticated)', () => {
    const smsPath = spec.paths['/api/v1/webhooks/twilio/sms'];
    expect(smsPath).toBeDefined();
    const postOp = smsPath!['post'];
    expect(postOp).toBeDefined();
    expect(postOp!.security).toEqual([]);
  });

  it('operations include rate limit extension', () => {
    const customerPath = spec.paths['/api/v1/customers'];
    const getOp = customerPath!['get']!;
    expect(getOp['x-rate-limit']).toBeGreaterThan(0);
  });

  it('operations include error responses', () => {
    const customerPath = spec.paths['/api/v1/customers'];
    const getOp = customerPath!['get']!;
    expect(getOp.responses).toHaveProperty('401');
    expect(getOp.responses).toHaveProperty('403');
  });

  it('path parameter operations include parameters', () => {
    const customerIdPath = spec.paths['/api/v1/customers/{id}'];
    expect(customerIdPath).toBeDefined();
    const getOp = customerIdPath!['get']!;
    expect(getOp.parameters).toBeDefined();
    expect(getOp.parameters!.length).toBeGreaterThan(0);
    expect(getOp.parameters![0]!.name).toBe('id');
    expect(getOp.parameters![0]!.in).toBe('path');
  });

  it('POST operations include request body reference', () => {
    const customerPath = spec.paths['/api/v1/customers'];
    const postOp = customerPath!['post']!;
    expect(postOp.requestBody).toBeDefined();
    expect(postOp.requestBody!.required).toBe(true);
    expect(postOp.requestBody!.content['application/json'].schema['$ref']).toContain('CreateCustomerRequest');
  });

  it('is JSON-serializable', () => {
    const serialized = JSON.stringify(spec);
    expect(serialized).toBeDefined();
    const parsed = JSON.parse(serialized);
    expect(parsed.openapi).toBe('3.1.0');
  });
});

// ── Spec from empty registry ─────────────────────────────────────

describe('generateOpenAPISpec with empty registry', () => {
  it('generates valid spec with no paths', () => {
    const registry = new RouteRegistry();
    const spec = generateOpenAPISpec(registry);

    expect(spec.openapi).toBe('3.1.0');
    expect(Object.keys(spec.paths)).toHaveLength(0);
    expect(spec.tags).toHaveLength(0);
    expect(spec.components.securitySchemes).toBeDefined();
  });
});
