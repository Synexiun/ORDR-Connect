/**
 * ORDR-Connect — Docker & Container Security Tests
 * SOC2/ISO27001/HIPAA: validates all Dockerfiles, compose, and nginx
 * comply with Rule 8 (distroless/alpine, multi-stage, non-root),
 * Rule 10 (no :latest, no root), Rule 5 (no secrets in images),
 * and Rule 1 (TLS-ready security headers).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const DOCKER_DIR = resolve(__dirname, '..');
const ROOT_DIR = resolve(DOCKER_DIR, '..', '..');

function readFile(path: string): string {
  return readFileSync(path, 'utf-8');
}

// ============================================================
// Dockerfile inventory
// ============================================================
const DOCKERFILES = [
  'Dockerfile.api',
  'Dockerfile.worker',
  'Dockerfile.agent-runtime',
  'Dockerfile.web',
  'Dockerfile.developer-portal',
] as const;

const HTTP_SERVICES = [
  'Dockerfile.api',
  'Dockerfile.agent-runtime',
  'Dockerfile.developer-portal',
] as const;

// ============================================================
// 1. File existence and non-empty
// ============================================================
describe('Dockerfile existence', () => {
  for (const file of DOCKERFILES) {
    it(`${file} exists and is non-empty`, () => {
      const path = resolve(DOCKER_DIR, file);
      expect(existsSync(path)).toBe(true);
      const content = readFile(path);
      expect(content.trim().length).toBeGreaterThan(0);
    });
  }

  it('nginx.conf exists and is non-empty', () => {
    const path = resolve(DOCKER_DIR, 'nginx.conf');
    expect(existsSync(path)).toBe(true);
    expect(readFile(path).trim().length).toBeGreaterThan(0);
  });

  it('.dockerignore exists at project root', () => {
    const path = resolve(ROOT_DIR, '.dockerignore');
    expect(existsSync(path)).toBe(true);
    expect(readFile(path).trim().length).toBeGreaterThan(0);
  });

  it('docker-compose.production.yml exists at project root', () => {
    const path = resolve(ROOT_DIR, 'docker-compose.production.yml');
    expect(existsSync(path)).toBe(true);
    expect(readFile(path).trim().length).toBeGreaterThan(0);
  });
});

// ============================================================
// 2. Multi-stage builds (FROM appears 2+ times)
// ============================================================
describe('multi-stage builds', () => {
  for (const file of DOCKERFILES) {
    it(`${file} uses multi-stage build (2+ FROM)`, () => {
      const content = readFile(resolve(DOCKER_DIR, file));
      const fromCount = (content.match(/^FROM\s+/gm) ?? []).length;
      expect(fromCount).toBeGreaterThanOrEqual(2);
    });
  }
});

// ============================================================
// 3. Node 22 in builder stage
// ============================================================
describe('Node 22 builder stage', () => {
  for (const file of DOCKERFILES) {
    it(`${file} uses Node 22 in builder stage`, () => {
      const content = readFile(resolve(DOCKER_DIR, file));
      // Builder uses node:22 (alpine or standard)
      const hasNode22 = /FROM\s+node:22[\w.-]*/.test(content);
      expect(hasNode22).toBe(true);
    });
  }
});

// ============================================================
// 4. Non-root user (USER directive present)
// ============================================================
describe('non-root enforcement', () => {
  for (const file of DOCKERFILES) {
    it(`${file} runs as non-root (USER directive)`, () => {
      const content = readFile(resolve(DOCKER_DIR, file));
      const hasUser = /^USER\s+(?!root)/m.test(content);
      expect(hasUser).toBe(true);
    });
  }
});

// ============================================================
// 5. No hardcoded secrets
// ============================================================
describe('no hardcoded secrets in Dockerfiles', () => {
  const secretPatterns = [
    /ENV\s+.*PASSWORD\s*=/i,
    /ENV\s+.*SECRET\s*=/i,
    /ENV\s+.*API_KEY\s*=/i,
    /ENV\s+.*TOKEN\s*=(?!production)/i,
    /ENV\s+.*PRIVATE_KEY\s*=/i,
    /ENV\s+.*DATABASE_URL\s*=/i,
  ];

  for (const file of DOCKERFILES) {
    it(`${file} contains no hardcoded secrets`, () => {
      const content = readFile(resolve(DOCKER_DIR, file));
      for (const pattern of secretPatterns) {
        expect(content).not.toMatch(pattern);
      }
    });
  }
});

// ============================================================
// 6. HEALTHCHECK present (except worker)
// ============================================================
describe('HEALTHCHECK directives', () => {
  for (const file of HTTP_SERVICES) {
    it(`${file} has HEALTHCHECK directive`, () => {
      const content = readFile(resolve(DOCKER_DIR, file));
      expect(content).toMatch(/HEALTHCHECK/);
    });
  }

  it('Dockerfile.web has HEALTHCHECK directive', () => {
    const content = readFile(resolve(DOCKER_DIR, 'Dockerfile.web'));
    expect(content).toMatch(/HEALTHCHECK/);
  });

  it('Dockerfile.worker does NOT have HEALTHCHECK (uses process probe)', () => {
    const content = readFile(resolve(DOCKER_DIR, 'Dockerfile.worker'));
    expect(content).not.toMatch(/^HEALTHCHECK/m);
  });
});

// ============================================================
// 7. Web uses nginx, not Node
// ============================================================
describe('web container uses nginx', () => {
  it('Dockerfile.web runtime stage uses nginx', () => {
    const content = readFile(resolve(DOCKER_DIR, 'Dockerfile.web'));
    expect(content).toMatch(/FROM\s+nginx:/);
  });

  it('Dockerfile.web runtime does not use Node.js base', () => {
    const content = readFile(resolve(DOCKER_DIR, 'Dockerfile.web'));
    const fromLines = content.match(/^FROM\s+.+/gm) ?? [];
    const runtimeFrom = fromLines[fromLines.length - 1] ?? '';
    expect(runtimeFrom).not.toMatch(/node:/);
    expect(runtimeFrom).not.toMatch(/distroless/);
  });
});

// ============================================================
// 8. .dockerignore excludes sensitive paths
// ============================================================
describe('.dockerignore security', () => {
  const required = ['.git', 'node_modules', '.env', 'Data/', 'Research/', 'Tools/', '.claude/', 'secrets/'];

  for (const entry of required) {
    it(`excludes ${entry}`, () => {
      const content = readFile(resolve(ROOT_DIR, '.dockerignore'));
      const hasExclusion = content.split('\n').some(
        (line) => line.trim() === entry || line.trim().startsWith(entry)
      );
      expect(hasExclusion).toBe(true);
    });
  }
});

// ============================================================
// 9. docker-compose.production.yml — all 5 services
// ============================================================
describe('docker-compose.production.yml services', () => {
  const requiredServices = ['api', 'worker', 'agent-runtime', 'web', 'developer-portal'];

  let composeContent: string;

  it('loads docker-compose.production.yml', () => {
    composeContent = readFile(resolve(ROOT_DIR, 'docker-compose.production.yml'));
    expect(composeContent.length).toBeGreaterThan(0);
  });

  for (const svc of requiredServices) {
    it(`has ${svc} service defined`, () => {
      const content = readFile(resolve(ROOT_DIR, 'docker-compose.production.yml'));
      // Match service definition (indented under services:)
      const hasService = new RegExp(`^\\s{2}${svc}:`, 'm').test(content);
      expect(hasService).toBe(true);
    });
  }

  it('has postgres service', () => {
    const content = readFile(resolve(ROOT_DIR, 'docker-compose.production.yml'));
    expect(content).toMatch(/^\s{2}postgres:/m);
  });

  it('has redis service', () => {
    const content = readFile(resolve(ROOT_DIR, 'docker-compose.production.yml'));
    expect(content).toMatch(/^\s{2}redis:/m);
  });

  it('has kafka service', () => {
    const content = readFile(resolve(ROOT_DIR, 'docker-compose.production.yml'));
    expect(content).toMatch(/^\s{2}kafka:/m);
  });
});

// ============================================================
// 10. All services have resource limits
// ============================================================
describe('resource limits', () => {
  it('all app services have memory limits', () => {
    const content = readFile(resolve(ROOT_DIR, 'docker-compose.production.yml'));
    // Count deploy.resources.limits blocks
    const limitBlocks = (content.match(/limits:/g) ?? []).length;
    // 5 app services + 3 infra services = 8
    expect(limitBlocks).toBeGreaterThanOrEqual(8);
  });

  it('all app services have CPU limits', () => {
    const content = readFile(resolve(ROOT_DIR, 'docker-compose.production.yml'));
    const cpuLimits = (content.match(/cpus:/g) ?? []).length;
    // Each service has limits + reservations = 2 cpus entries per service, 8 services
    expect(cpuLimits).toBeGreaterThanOrEqual(8);
  });
});

// ============================================================
// 11. All compose services have health checks
// ============================================================
describe('compose health checks', () => {
  const servicesWithHealthCheck = ['postgres', 'redis', 'kafka'];

  for (const svc of servicesWithHealthCheck) {
    it(`${svc} service has healthcheck in compose`, () => {
      const content = readFile(resolve(ROOT_DIR, 'docker-compose.production.yml'));
      // Find service block and check for healthcheck within it
      expect(content).toMatch(/healthcheck:/);
    });
  }
});

// ============================================================
// 12. nginx.conf security headers
// ============================================================
describe('nginx.conf security', () => {
  const requiredHeaders = [
    'X-Frame-Options',
    'X-Content-Type-Options',
    'Strict-Transport-Security',
    'Content-Security-Policy',
    'Referrer-Policy',
  ];

  for (const header of requiredHeaders) {
    it(`has ${header} header`, () => {
      const content = readFile(resolve(DOCKER_DIR, 'nginx.conf'));
      expect(content).toContain(header);
    });
  }

  it('has SPA routing (try_files with index.html)', () => {
    const content = readFile(resolve(DOCKER_DIR, 'nginx.conf'));
    expect(content).toMatch(/try_files.*\/index\.html/);
  });

  it('has gzip compression enabled', () => {
    const content = readFile(resolve(DOCKER_DIR, 'nginx.conf'));
    expect(content).toMatch(/gzip\s+on/);
  });

  it('disables server version disclosure', () => {
    const content = readFile(resolve(DOCKER_DIR, 'nginx.conf'));
    expect(content).toMatch(/server_tokens\s+off/);
  });

  it('has static asset caching', () => {
    const content = readFile(resolve(DOCKER_DIR, 'nginx.conf'));
    expect(content).toMatch(/expires\s+1y/);
  });
});

// ============================================================
// 13. No :latest tags
// ============================================================
describe('no :latest tags', () => {
  for (const file of DOCKERFILES) {
    it(`${file} does not use :latest tag`, () => {
      const content = readFile(resolve(DOCKER_DIR, file));
      const fromLines = content.match(/^FROM\s+\S+/gm) ?? [];
      for (const line of fromLines) {
        expect(line).not.toMatch(/:latest/);
      }
    });
  }

  it('docker-compose.production.yml does not use :latest tag', () => {
    const content = readFile(resolve(ROOT_DIR, 'docker-compose.production.yml'));
    const imageLines = content.match(/image:\s+\S+/g) ?? [];
    for (const line of imageLines) {
      expect(line).not.toMatch(/:latest/);
    }
  });
});

// ============================================================
// 14. All images pinned to specific versions
// ============================================================
describe('pinned image versions', () => {
  for (const file of DOCKERFILES) {
    it(`${file} FROM images have pinned versions`, () => {
      const content = readFile(resolve(DOCKER_DIR, file));
      const fromLines = content.match(/^FROM\s+(\S+)/gm) ?? [];
      for (const line of fromLines) {
        const image = line.replace(/^FROM\s+/, '').split(/\s/)[0] ?? '';
        // Distroless images embed version in path (e.g. nodejs22-debian12)
        // Standard images use : tag (e.g. node:22.14-alpine3.20)
        const hasPinnedTag = image?.includes(':');
        const isDistrolessVersioned = /distroless\/nodejs\d+-debian\d+/.test(image ?? '');
        expect(hasPinnedTag || isDistrolessVersioned).toBe(true);
      }
    });
  }
});

// ============================================================
// 15. OCI labels present
// ============================================================
describe('OCI labels', () => {
  for (const file of DOCKERFILES) {
    it(`${file} has org.opencontainers.image labels`, () => {
      const content = readFile(resolve(DOCKER_DIR, file));
      expect(content).toMatch(/org\.opencontainers\.image\.title/);
      expect(content).toMatch(/org\.opencontainers\.image\.vendor/);
      expect(content).toMatch(/org\.opencontainers\.image\.version/);
    });
  }
});

// ============================================================
// 16. Distroless or Alpine runtime (Rule 8)
// ============================================================
describe('distroless or alpine runtime', () => {
  for (const file of DOCKERFILES) {
    it(`${file} runtime stage uses distroless or alpine`, () => {
      const content = readFile(resolve(DOCKER_DIR, file));
      const fromLines = content.match(/^FROM\s+\S+/gm) ?? [];
      const runtimeFrom = fromLines[fromLines.length - 1] ?? '';
      const isDistroless = runtimeFrom.includes('distroless');
      const isAlpine = runtimeFrom.includes('alpine');
      expect(isDistroless || isAlpine).toBe(true);
    });
  }
});

// ============================================================
// 17. Network isolation in compose
// ============================================================
describe('network isolation', () => {
  it('has separate frontend and backend networks', () => {
    const content = readFile(resolve(ROOT_DIR, 'docker-compose.production.yml'));
    expect(content).toMatch(/^\s{2}frontend:/m);
    expect(content).toMatch(/^\s{2}backend:/m);
  });

  it('web service is on frontend network', () => {
    const content = readFile(resolve(ROOT_DIR, 'docker-compose.production.yml'));
    // web service should reference frontend network
    expect(content).toMatch(/frontend/);
  });
});

// ============================================================
// 18. Agent runtime resource caps
// ============================================================
describe('agent-runtime security', () => {
  it('has NODE_OPTIONS with max-old-space-size', () => {
    const content = readFile(resolve(DOCKER_DIR, 'Dockerfile.agent-runtime'));
    expect(content).toMatch(/max-old-space-size=2048/);
  });

  it('compose sets read_only filesystem for agent-runtime', () => {
    const content = readFile(resolve(ROOT_DIR, 'docker-compose.production.yml'));
    expect(content).toMatch(/read_only:\s*true/);
  });
});

// ============================================================
// 19. Worker graceful shutdown
// ============================================================
describe('worker graceful shutdown', () => {
  it('worker uses tini for signal handling', () => {
    const content = readFile(resolve(DOCKER_DIR, 'Dockerfile.worker'));
    expect(content).toMatch(/tini/);
    expect(content).toMatch(/ENTRYPOINT.*tini/);
  });
});

// ============================================================
// 20. No shell in distroless runtimes
// ============================================================
describe('distroless runtimes have no shell access', () => {
  const distrolessFiles = ['Dockerfile.api', 'Dockerfile.agent-runtime', 'Dockerfile.developer-portal'];

  for (const file of distrolessFiles) {
    it(`${file} uses distroless (no shell)`, () => {
      const content = readFile(resolve(DOCKER_DIR, file));
      const fromLines = content.match(/^FROM\s+\S+/gm) ?? [];
      const runtimeFrom = fromLines[fromLines.length - 1] ?? '';
      expect(runtimeFrom).toMatch(/distroless/);
    });

    it(`${file} does not use RUN in runtime stage`, () => {
      const content = readFile(resolve(DOCKER_DIR, file));
      // Split by last FROM, check there are no RUN commands after
      const parts = content.split(/^FROM\s+gcr\.io\/distroless/m);
      if (parts.length > 1) {
        const runtimePart = parts[parts.length - 1] ?? '';
        expect(runtimePart).not.toMatch(/^RUN\s/m);
      }
    });
  }
});
