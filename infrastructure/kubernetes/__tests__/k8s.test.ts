/**
 * ORDR-Connect — Kubernetes Manifest Validation Tests
 * SOC 2 Type II | ISO 27001:2022 | HIPAA Compliant
 *
 * Validates all K8s YAML manifests against compliance requirements:
 * - CLAUDE.md Rule 2: mTLS mandatory (Istio STRICT)
 * - CLAUDE.md Rule 10: Pod Security Standards, NetworkPolicies, ResourceQuotas
 * - All containers: non-root, read-only fs, drop ALL capabilities
 * - Resource limits mandatory on every container
 * - No default ServiceAccount usage
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { parseAllDocuments } from 'yaml';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const K8S_ROOT = join(__dirname, '..');
const APPS = ['api', 'worker', 'agent-runtime', 'web', 'developer-portal'];

interface K8sResource {
  apiVersion?: string;
  kind?: string;
  metadata?: {
    name?: string;
    namespace?: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
  };
  spec?: Record<string, unknown>;
  automountServiceAccountToken?: boolean;
  [key: string]: unknown;
}

function findYamlFiles(dir: string): string[] {
  const results: string[] = [];
  if (!existsSync(dir)) return results;

  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== '__tests__' && entry.name !== 'node_modules') {
      results.push(...findYamlFiles(fullPath));
    } else if (entry.isFile() && (entry.name.endsWith('.yaml') || entry.name.endsWith('.yml'))) {
      results.push(fullPath);
    }
  }
  return results;
}

function parseYaml(filePath: string): K8sResource[] {
  const content = readFileSync(filePath, 'utf-8');
  const docs = parseAllDocuments(content);
  return docs
    .map(doc => doc.toJSON() as K8sResource)
    .filter((doc): doc is K8sResource => doc !== null && doc !== undefined);
}

function getAllResources(): { path: string; resource: K8sResource }[] {
  const yamlFiles = findYamlFiles(K8S_ROOT).filter(f => !f.includes('overlays'));
  const resources: { path: string; resource: K8sResource }[] = [];

  for (const file of yamlFiles) {
    const parsed = parseYaml(file);
    for (const resource of parsed) {
      resources.push({ path: file, resource });
    }
  }
  return resources;
}

function getResourcesByKind(kind: string): K8sResource[] {
  return getAllResources()
    .filter(r => r.resource.kind === kind)
    .map(r => r.resource);
}

function getDeployments(): K8sResource[] {
  return getResourcesByKind('Deployment');
}

function getAppDeployment(appName: string): K8sResource | undefined {
  return getDeployments().find(d => d.metadata?.name === appName);
}

const allYamlFiles = findYamlFiles(K8S_ROOT);
const baseYamlFiles = allYamlFiles.filter(f => !f.includes('overlays'));
const allResources = getAllResources();

// ---------------------------------------------------------------------------
// 1. YAML Validity
// ---------------------------------------------------------------------------

describe('YAML Validity', () => {
  it('all YAML files should be valid and parseable', () => {
    for (const file of baseYamlFiles) {
      const relPath = relative(K8S_ROOT, file);
      expect(() => parseYaml(file), `Invalid YAML: ${relPath}`).not.toThrow();
    }
  });

  it('all YAML files should have apiVersion and kind', () => {
    for (const { path, resource } of allResources) {
      const relPath = relative(K8S_ROOT, path);
      expect(resource.apiVersion, `Missing apiVersion in ${relPath}`).toBeDefined();
      expect(resource.kind, `Missing kind in ${relPath}`).toBeDefined();
    }
  });

  it('should have YAML files for each app directory', () => {
    for (const app of APPS) {
      const appDir = join(K8S_ROOT, 'apps', app);
      expect(existsSync(appDir), `Missing app directory: ${app}`).toBe(true);
      const yamlFiles = findYamlFiles(appDir);
      expect(yamlFiles.length, `No YAML files in ${app}`).toBeGreaterThanOrEqual(4);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Resource Limits on ALL Deployments
// ---------------------------------------------------------------------------

describe('Resource Limits (Rule 10)', () => {
  const deployments = getDeployments();

  it('should have deployments for all apps', () => {
    expect(deployments.length).toBeGreaterThanOrEqual(APPS.length);
  });

  it.each(APPS)('deployment %s should have resource limits', (app) => {
    const deployment = getAppDeployment(app);
    expect(deployment, `Missing deployment for ${app}`).toBeDefined();

    const containers = (deployment?.spec as Record<string, unknown>)?.template as Record<string, unknown>;
    const podSpec = containers?.spec as Record<string, unknown>;
    const containerList = podSpec?.containers as Array<Record<string, unknown>>;

    expect(containerList, `No containers in ${app} deployment`).toBeDefined();
    expect(containerList.length).toBeGreaterThan(0);

    for (const container of containerList) {
      const resources = container.resources as Record<string, Record<string, string>>;
      expect(resources, `Missing resources in container ${container.name} of ${app}`).toBeDefined();
      expect(resources.limits, `Missing limits in container ${container.name} of ${app}`).toBeDefined();
      expect(resources.limits.cpu, `Missing CPU limit in ${app}`).toBeDefined();
      expect(resources.limits.memory, `Missing memory limit in ${app}`).toBeDefined();
      expect(resources.requests, `Missing requests in container ${container.name} of ${app}`).toBeDefined();
      expect(resources.requests.cpu, `Missing CPU request in ${app}`).toBeDefined();
      expect(resources.requests.memory, `Missing memory request in ${app}`).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Security Context — runAsNonRoot, readOnlyRootFilesystem
// ---------------------------------------------------------------------------

describe('Security Context (Rule 10)', () => {
  it.each(APPS)('deployment %s should have pod-level runAsNonRoot', (app) => {
    const deployment = getAppDeployment(app);
    const template = (deployment?.spec as Record<string, unknown>)?.template as Record<string, unknown>;
    const podSpec = template?.spec as Record<string, unknown>;
    const securityContext = podSpec?.securityContext as Record<string, unknown>;

    expect(securityContext, `Missing pod securityContext in ${app}`).toBeDefined();
    expect(securityContext.runAsNonRoot, `runAsNonRoot not set in ${app}`).toBe(true);
  });

  it.each(APPS)('deployment %s containers should have readOnlyRootFilesystem', (app) => {
    const deployment = getAppDeployment(app);
    const template = (deployment?.spec as Record<string, unknown>)?.template as Record<string, unknown>;
    const podSpec = template?.spec as Record<string, unknown>;
    const containers = podSpec?.containers as Array<Record<string, unknown>>;

    for (const container of containers) {
      const sc = container.securityContext as Record<string, unknown>;
      expect(sc, `Missing container securityContext in ${app}/${container.name}`).toBeDefined();
      expect(sc.readOnlyRootFilesystem, `readOnlyRootFilesystem not set in ${app}/${container.name}`).toBe(true);
    }
  });

  it.each(APPS)('deployment %s containers should drop ALL capabilities', (app) => {
    const deployment = getAppDeployment(app);
    const template = (deployment?.spec as Record<string, unknown>)?.template as Record<string, unknown>;
    const podSpec = template?.spec as Record<string, unknown>;
    const containers = podSpec?.containers as Array<Record<string, unknown>>;

    for (const container of containers) {
      const sc = container.securityContext as Record<string, unknown>;
      const caps = sc?.capabilities as Record<string, string[]>;
      expect(caps, `Missing capabilities in ${app}/${container.name}`).toBeDefined();
      expect(caps.drop, `Missing drop in ${app}/${container.name}`).toBeDefined();
      expect(caps.drop).toContain('ALL');
    }
  });

  it.each(APPS)('deployment %s should disallow privilege escalation', (app) => {
    const deployment = getAppDeployment(app);
    const template = (deployment?.spec as Record<string, unknown>)?.template as Record<string, unknown>;
    const podSpec = template?.spec as Record<string, unknown>;
    const containers = podSpec?.containers as Array<Record<string, unknown>>;

    for (const container of containers) {
      const sc = container.securityContext as Record<string, unknown>;
      expect(sc.allowPrivilegeEscalation, `allowPrivilegeEscalation not false in ${app}/${container.name}`).toBe(false);
    }
  });

  it('no deployment should run as privileged', () => {
    for (const deployment of getDeployments()) {
      const template = (deployment.spec as Record<string, unknown>)?.template as Record<string, unknown>;
      const podSpec = template?.spec as Record<string, unknown>;
      const containers = podSpec?.containers as Array<Record<string, unknown>>;

      for (const container of containers ?? []) {
        const sc = container.securityContext as Record<string, unknown>;
        if (sc?.privileged !== undefined) {
          expect(sc.privileged).toBe(false);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Liveness + Readiness Probes
// ---------------------------------------------------------------------------

describe('Health Probes', () => {
  it.each(APPS)('deployment %s should have liveness probe', (app) => {
    const deployment = getAppDeployment(app);
    const template = (deployment?.spec as Record<string, unknown>)?.template as Record<string, unknown>;
    const podSpec = template?.spec as Record<string, unknown>;
    const containers = podSpec?.containers as Array<Record<string, unknown>>;

    for (const container of containers) {
      expect(container.livenessProbe, `Missing livenessProbe in ${app}/${container.name}`).toBeDefined();
    }
  });

  it.each(APPS)('deployment %s should have readiness probe', (app) => {
    const deployment = getAppDeployment(app);
    const template = (deployment?.spec as Record<string, unknown>)?.template as Record<string, unknown>;
    const podSpec = template?.spec as Record<string, unknown>;
    const containers = podSpec?.containers as Array<Record<string, unknown>>;

    for (const container of containers) {
      expect(container.readinessProbe, `Missing readinessProbe in ${app}/${container.name}`).toBeDefined();
    }
  });

  it.each(APPS)('deployment %s should have startup probe', (app) => {
    const deployment = getAppDeployment(app);
    const template = (deployment?.spec as Record<string, unknown>)?.template as Record<string, unknown>;
    const podSpec = template?.spec as Record<string, unknown>;
    const containers = podSpec?.containers as Array<Record<string, unknown>>;

    for (const container of containers) {
      expect(container.startupProbe, `Missing startupProbe in ${app}/${container.name}`).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Services with Correct Selectors
// ---------------------------------------------------------------------------

describe('Services', () => {
  it.each(APPS)('service %s should exist with correct selectors', (app) => {
    const services = getResourcesByKind('Service');
    const svc = services.find(s => s.metadata?.name === app);
    expect(svc, `Missing service for ${app}`).toBeDefined();

    const selector = (svc?.spec as Record<string, unknown>)?.selector as Record<string, string>;
    expect(selector, `Missing selector in service ${app}`).toBeDefined();
    expect(selector['app.kubernetes.io/name']).toBe(app);
  });

  it.each(APPS)('service %s should be ClusterIP type', (app) => {
    const services = getResourcesByKind('Service');
    const svc = services.find(s => s.metadata?.name === app);
    expect((svc?.spec as Record<string, unknown>)?.type).toBe('ClusterIP');
  });
});

// ---------------------------------------------------------------------------
// 6. NetworkPolicies
// ---------------------------------------------------------------------------

describe('NetworkPolicies (Rule 10)', () => {
  it.each(APPS)('should have NetworkPolicy for %s', (app) => {
    const policies = getResourcesByKind('NetworkPolicy');
    const appPolicy = policies.find(p =>
      p.metadata?.name?.includes(app) && !p.metadata?.name?.startsWith('default-')
    );
    expect(appPolicy, `Missing NetworkPolicy for ${app}`).toBeDefined();
  });

  it('should have default deny ingress policy', () => {
    const policies = getResourcesByKind('NetworkPolicy');
    const denyIngress = policies.find(p => p.metadata?.name === 'default-deny-ingress');
    expect(denyIngress).toBeDefined();

    const spec = denyIngress?.spec as Record<string, unknown>;
    const policyTypes = spec?.policyTypes as string[];
    expect(policyTypes).toContain('Ingress');
  });

  it('should have default deny egress policy', () => {
    const policies = getResourcesByKind('NetworkPolicy');
    const denyEgress = policies.find(p => p.metadata?.name === 'default-deny-egress');
    expect(denyEgress).toBeDefined();

    const spec = denyEgress?.spec as Record<string, unknown>;
    const policyTypes = spec?.policyTypes as string[];
    expect(policyTypes).toContain('Egress');
  });

  it('should have DNS allow policy', () => {
    const policies = getResourcesByKind('NetworkPolicy');
    const dnsPolicy = policies.find(p => p.metadata?.name === 'allow-dns');
    expect(dnsPolicy).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 7. HorizontalPodAutoscaler
// ---------------------------------------------------------------------------

describe('HorizontalPodAutoscaler', () => {
  it.each(APPS)('HPA for %s should have minReplicas >= 2', (app) => {
    const hpas = getResourcesByKind('HorizontalPodAutoscaler');
    const hpa = hpas.find(h => h.metadata?.name === app);
    expect(hpa, `Missing HPA for ${app}`).toBeDefined();

    const spec = hpa?.spec as Record<string, unknown>;
    expect(spec?.minReplicas as number, `HPA ${app} minReplicas < 2`).toBeGreaterThanOrEqual(2);
  });

  it('API HPA should have minReplicas >= 3', () => {
    const hpas = getResourcesByKind('HorizontalPodAutoscaler');
    const hpa = hpas.find(h => h.metadata?.name === 'api');
    const spec = hpa?.spec as Record<string, unknown>;
    expect(spec?.minReplicas as number).toBeGreaterThanOrEqual(3);
  });

  it('agent-runtime HPA should have maxReplicas <= 5', () => {
    const hpas = getResourcesByKind('HorizontalPodAutoscaler');
    const hpa = hpas.find(h => h.metadata?.name === 'agent-runtime');
    const spec = hpa?.spec as Record<string, unknown>;
    expect(spec?.maxReplicas as number).toBeLessThanOrEqual(5);
  });
});

// ---------------------------------------------------------------------------
// 8. KEDA ScaledObject
// ---------------------------------------------------------------------------

describe('KEDA ScaledObject', () => {
  it('worker should have a KEDA ScaledObject', () => {
    const scaledObjects = getResourcesByKind('ScaledObject');
    const workerScaler = scaledObjects.find(s => s.metadata?.name?.includes('worker'));
    expect(workerScaler).toBeDefined();
  });

  it('KEDA ScaledObject should target Kafka topic', () => {
    const scaledObjects = getResourcesByKind('ScaledObject');
    const workerScaler = scaledObjects.find(s => s.metadata?.name?.includes('worker'));
    const spec = workerScaler?.spec as Record<string, unknown>;
    const triggers = spec?.triggers as Array<Record<string, unknown>>;

    expect(triggers).toBeDefined();
    const kafkaTrigger = triggers.find(t => t.type === 'kafka');
    expect(kafkaTrigger, 'Missing kafka trigger').toBeDefined();

    const metadata = kafkaTrigger?.metadata as Record<string, string>;
    expect(metadata?.topic).toBeDefined();
    expect(metadata?.lagThreshold).toBe('100');
  });
});

// ---------------------------------------------------------------------------
// 9. Istio PeerAuthentication — STRICT mTLS
// ---------------------------------------------------------------------------

describe('Istio mTLS (Rule 1 + Rule 2)', () => {
  it('should have namespace-wide STRICT PeerAuthentication', () => {
    const peerAuths = getResourcesByKind('PeerAuthentication');
    expect(peerAuths.length).toBeGreaterThanOrEqual(1);

    const namespaceWide = peerAuths.find(p =>
      p.metadata?.name === 'ordr-system-mtls'
    );
    expect(namespaceWide, 'Missing namespace-wide PeerAuthentication').toBeDefined();

    const spec = namespaceWide?.spec as Record<string, unknown>;
    const mtls = spec?.mtls as Record<string, string>;
    expect(mtls?.mode).toBe('STRICT');
  });

  it('all PeerAuthentication resources should be STRICT', () => {
    const peerAuths = getResourcesByKind('PeerAuthentication');
    for (const pa of peerAuths) {
      const spec = pa.spec as Record<string, unknown>;
      const mtls = spec?.mtls as Record<string, string>;
      expect(mtls?.mode, `PeerAuth ${pa.metadata?.name} not STRICT`).toBe('STRICT');
    }
  });
});

// ---------------------------------------------------------------------------
// 10. Istio DestinationRules
// ---------------------------------------------------------------------------

describe('Istio DestinationRules', () => {
  it.each(APPS)('should have DestinationRule for %s', (app) => {
    const rules = getResourcesByKind('DestinationRule');
    const rule = rules.find(r => r.metadata?.name?.includes(app));
    expect(rule, `Missing DestinationRule for ${app}`).toBeDefined();
  });

  it('all DestinationRules should use ISTIO_MUTUAL TLS', () => {
    const rules = getResourcesByKind('DestinationRule');
    for (const rule of rules) {
      const spec = rule.spec as Record<string, unknown>;
      const trafficPolicy = spec?.trafficPolicy as Record<string, unknown>;
      const tls = trafficPolicy?.tls as Record<string, string>;
      expect(tls?.mode, `DestinationRule ${rule.metadata?.name} TLS not ISTIO_MUTUAL`).toBe('ISTIO_MUTUAL');
    }
  });
});

// ---------------------------------------------------------------------------
// 11. No Privileged Containers
// ---------------------------------------------------------------------------

describe('No Privileged Containers', () => {
  it('no container should run as privileged across all manifests', () => {
    for (const { path, resource } of allResources) {
      if (resource.kind !== 'Deployment') continue;

      const template = (resource.spec as Record<string, unknown>)?.template as Record<string, unknown>;
      const podSpec = template?.spec as Record<string, unknown>;
      const containers = podSpec?.containers as Array<Record<string, unknown>> ?? [];

      for (const container of containers) {
        const sc = container.securityContext as Record<string, unknown>;
        if (sc?.privileged !== undefined) {
          expect(sc.privileged, `Privileged container in ${relative(K8S_ROOT, path)}`).not.toBe(true);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 12. ServiceAccounts with IRSA Annotations
// ---------------------------------------------------------------------------

describe('ServiceAccounts with IRSA', () => {
  it.each(APPS)('should have ServiceAccount for %s', (app) => {
    const serviceAccounts = getResourcesByKind('ServiceAccount');
    const sa = serviceAccounts.find(s => s.metadata?.name === app);
    expect(sa, `Missing ServiceAccount for ${app}`).toBeDefined();
  });

  it.each(APPS)('ServiceAccount %s should have IRSA annotation', (app) => {
    const serviceAccounts = getResourcesByKind('ServiceAccount');
    const sa = serviceAccounts.find(s => s.metadata?.name === app);
    expect(sa?.metadata?.annotations?.['eks.amazonaws.com/role-arn'],
      `Missing IRSA annotation on ServiceAccount ${app}`
    ).toBeDefined();
  });

  it.each(APPS)('ServiceAccount %s should disable automount', (app) => {
    const serviceAccounts = getResourcesByKind('ServiceAccount');
    const sa = serviceAccounts.find(s => s.metadata?.name === app);
    expect(sa?.automountServiceAccountToken, `ServiceAccount ${app} automount not disabled`).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 13. Namespace Labels
// ---------------------------------------------------------------------------

describe('Namespace Configuration', () => {
  it('namespace should have Pod Security Standards labels', () => {
    const namespaces = getResourcesByKind('Namespace');
    const ordrNs = namespaces.find(n => n.metadata?.name === 'ordr-system');
    expect(ordrNs, 'Missing ordr-system namespace').toBeDefined();

    const labels = ordrNs?.metadata?.labels;
    expect(labels?.['pod-security.kubernetes.io/enforce']).toBe('restricted');
    expect(labels?.['pod-security.kubernetes.io/audit']).toBe('restricted');
    expect(labels?.['pod-security.kubernetes.io/warn']).toBe('restricted');
  });

  it('namespace should have Istio injection enabled', () => {
    const namespaces = getResourcesByKind('Namespace');
    const ordrNs = namespaces.find(n => n.metadata?.name === 'ordr-system');
    expect(ordrNs?.metadata?.labels?.['istio-injection']).toBe('enabled');
  });

  it('namespace should have compliance label', () => {
    const namespaces = getResourcesByKind('Namespace');
    const ordrNs = namespaces.find(n => n.metadata?.name === 'ordr-system');
    expect(ordrNs?.metadata?.labels?.compliance).toBe('soc2-iso27001-hipaa');
  });
});

// ---------------------------------------------------------------------------
// 14. ResourceQuota Exists
// ---------------------------------------------------------------------------

describe('ResourceQuota', () => {
  it('should have ResourceQuota defined', () => {
    const quotas = getResourcesByKind('ResourceQuota');
    expect(quotas.length).toBeGreaterThanOrEqual(1);
  });

  it('ResourceQuota should set CPU and memory limits', () => {
    const quotas = getResourcesByKind('ResourceQuota');
    const quota = quotas[0];
    const hard = (quota?.spec as Record<string, Record<string, string>>)?.hard;
    expect(hard?.['requests.cpu']).toBeDefined();
    expect(hard?.['limits.cpu']).toBeDefined();
    expect(hard?.['requests.memory']).toBeDefined();
    expect(hard?.['limits.memory']).toBeDefined();
  });

  it('ResourceQuota should limit pods', () => {
    const quotas = getResourcesByKind('ResourceQuota');
    const quota = quotas[0];
    const hard = (quota?.spec as Record<string, Record<string, string>>)?.hard;
    expect(hard?.pods).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 15. LimitRange Exists
// ---------------------------------------------------------------------------

describe('LimitRange', () => {
  it('should have LimitRange defined', () => {
    const limitRanges = getResourcesByKind('LimitRange');
    expect(limitRanges.length).toBeGreaterThanOrEqual(1);
  });

  it('LimitRange should set default container limits', () => {
    const limitRanges = getResourcesByKind('LimitRange');
    const lr = limitRanges[0];
    const limits = (lr?.spec as Record<string, unknown>)?.limits as Array<Record<string, unknown>>;

    const containerLimit = limits?.find((l) => l.type === 'Container');
    expect(containerLimit, 'Missing Container limit in LimitRange').toBeDefined();
    expect((containerLimit?.default as Record<string, string>)?.cpu).toBeDefined();
    expect((containerLimit?.default as Record<string, string>)?.memory).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 16. PDBs in Production Overlay
// ---------------------------------------------------------------------------

describe('PodDisruptionBudgets (Production)', () => {
  const prodDir = join(K8S_ROOT, 'overlays', 'production');

  it('production overlay should exist', () => {
    expect(existsSync(prodDir)).toBe(true);
  });

  it.each(APPS)('should have PDB for %s in production', (app) => {
    const pdbFile = join(prodDir, `pdb-${app}.yaml`);
    expect(existsSync(pdbFile), `Missing PDB file for ${app}`).toBe(true);

    const resources = parseYaml(pdbFile);
    const pdb = resources.find(r => r.kind === 'PodDisruptionBudget');
    expect(pdb, `PDB for ${app} not a PodDisruptionBudget`).toBeDefined();

    const spec = pdb?.spec as Record<string, unknown>;
    expect(
      spec?.minAvailable !== undefined || spec?.maxUnavailable !== undefined,
      `PDB for ${app} missing minAvailable or maxUnavailable`
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 17. Kustomization Files
// ---------------------------------------------------------------------------

describe('Kustomization', () => {
  it('base kustomization.yaml should exist', () => {
    expect(existsSync(join(K8S_ROOT, 'kustomization.yaml'))).toBe(true);
  });

  it('staging overlay kustomization.yaml should exist', () => {
    expect(existsSync(join(K8S_ROOT, 'overlays', 'staging', 'kustomization.yaml'))).toBe(true);
  });

  it('production overlay kustomization.yaml should exist', () => {
    expect(existsSync(join(K8S_ROOT, 'overlays', 'production', 'kustomization.yaml'))).toBe(true);
  });

  it('base kustomization should reference all app resources', () => {
    const content = readFileSync(join(K8S_ROOT, 'kustomization.yaml'), 'utf-8');
    for (const app of APPS) {
      expect(content, `Missing ${app} in kustomization`).toContain(`apps/${app}/`);
    }
  });

  it('base kustomization should reference istio resources', () => {
    const content = readFileSync(join(K8S_ROOT, 'kustomization.yaml'), 'utf-8');
    expect(content).toContain('istio/');
  });

  it('base kustomization should reference monitoring resources', () => {
    const content = readFileSync(join(K8S_ROOT, 'kustomization.yaml'), 'utf-8');
    expect(content).toContain('monitoring/');
  });
});

// ---------------------------------------------------------------------------
// 18. Istio AuthorizationPolicies
// ---------------------------------------------------------------------------

describe('Istio AuthorizationPolicies', () => {
  it('should have default deny policy', () => {
    const policies = getResourcesByKind('AuthorizationPolicy');
    const denyAll = policies.find(p => p.metadata?.name === 'deny-all');
    expect(denyAll, 'Missing deny-all AuthorizationPolicy').toBeDefined();
  });

  it.each(APPS)('should have AuthorizationPolicy for %s', (app) => {
    const policies = getResourcesByKind('AuthorizationPolicy');
    const policy = policies.find(p => p.metadata?.name?.includes(app));
    expect(policy, `Missing AuthorizationPolicy for ${app}`).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 19. ServiceMonitors
// ---------------------------------------------------------------------------

describe('ServiceMonitors', () => {
  it.each(APPS)('should have ServiceMonitor for %s', (app) => {
    const monitors = getResourcesByKind('ServiceMonitor');
    const monitor = monitors.find(m => m.metadata?.name?.includes(app));
    expect(monitor, `Missing ServiceMonitor for ${app}`).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 20. PrometheusRules — Alert Severity Levels
// ---------------------------------------------------------------------------

describe('PrometheusRules', () => {
  it('should have PrometheusRule defined', () => {
    const rules = getResourcesByKind('PrometheusRule');
    expect(rules.length).toBeGreaterThanOrEqual(1);
  });

  it('should have alerts for all severity levels (P0-P3)', () => {
    const rules = getResourcesByKind('PrometheusRule');
    const content = readFileSync(
      join(K8S_ROOT, 'monitoring', 'prometheus-rules.yaml'),
      'utf-8'
    );
    expect(content).toContain('P0');
    expect(content).toContain('P1');
    expect(content).toContain('P2');
    expect(content).toContain('P3');
  });
});

// ---------------------------------------------------------------------------
// 21. VirtualServices
// ---------------------------------------------------------------------------

describe('Istio VirtualServices', () => {
  it.each(APPS)('should have VirtualService for %s', (app) => {
    const virtualServices = getResourcesByKind('VirtualService');
    const vs = virtualServices.find(v => v.metadata?.name?.includes(app));
    expect(vs, `Missing VirtualService for ${app}`).toBeDefined();
  });

  it('all VirtualServices should have retry policies', () => {
    const virtualServices = getResourcesByKind('VirtualService');
    for (const vs of virtualServices) {
      const spec = vs.spec as Record<string, unknown>;
      const httpRoutes = spec?.http as Array<Record<string, unknown>>;
      for (const route of httpRoutes ?? []) {
        expect(route.retries, `Missing retries on VirtualService ${vs.metadata?.name}`).toBeDefined();
      }
    }
  });

  it('all VirtualServices should have timeouts', () => {
    const virtualServices = getResourcesByKind('VirtualService');
    for (const vs of virtualServices) {
      const spec = vs.spec as Record<string, unknown>;
      const httpRoutes = spec?.http as Array<Record<string, unknown>>;
      for (const route of httpRoutes ?? []) {
        expect(route.timeout, `Missing timeout on VirtualService ${vs.metadata?.name}`).toBeDefined();
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 22. Deployments Use Dedicated ServiceAccounts
// ---------------------------------------------------------------------------

describe('Dedicated ServiceAccounts', () => {
  it.each(APPS)('deployment %s should use its own ServiceAccount', (app) => {
    const deployment = getAppDeployment(app);
    const template = (deployment?.spec as Record<string, unknown>)?.template as Record<string, unknown>;
    const podSpec = template?.spec as Record<string, unknown>;

    expect(podSpec?.serviceAccountName, `Missing serviceAccountName in ${app}`).toBe(app);
  });

  it.each(APPS)('deployment %s should disable automount', (app) => {
    const deployment = getAppDeployment(app);
    const template = (deployment?.spec as Record<string, unknown>)?.template as Record<string, unknown>;
    const podSpec = template?.spec as Record<string, unknown>;

    expect(podSpec?.automountServiceAccountToken, `automount not disabled in ${app}`).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 23. Agent Runtime — Higher Memory + Node Affinity
// ---------------------------------------------------------------------------

describe('Agent Runtime Specifics', () => {
  it('agent-runtime should have 2Gi memory limit', () => {
    const deployment = getAppDeployment('agent-runtime');
    const template = (deployment?.spec as Record<string, unknown>)?.template as Record<string, unknown>;
    const podSpec = template?.spec as Record<string, unknown>;
    const containers = podSpec?.containers as Array<Record<string, unknown>>;
    const resources = containers[0]?.resources as Record<string, Record<string, string>>;

    expect(resources.limits.memory).toBe('2Gi');
  });

  it('agent-runtime should have node selector for agent-runtime workload', () => {
    const deployment = getAppDeployment('agent-runtime');
    const template = (deployment?.spec as Record<string, unknown>)?.template as Record<string, unknown>;
    const podSpec = template?.spec as Record<string, unknown>;
    const nodeSelector = podSpec?.nodeSelector as Record<string, string>;

    expect(nodeSelector?.workload).toBe('agent-runtime');
  });

  it('agent-runtime should have toleration for agent-runtime taint', () => {
    const deployment = getAppDeployment('agent-runtime');
    const template = (deployment?.spec as Record<string, unknown>)?.template as Record<string, unknown>;
    const podSpec = template?.spec as Record<string, unknown>;
    const tolerations = podSpec?.tolerations as Array<Record<string, string>>;

    expect(tolerations).toBeDefined();
    const agentToleration = tolerations.find(t => t.key === 'workload' && t.value === 'agent-runtime');
    expect(agentToleration).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 24. seccompProfile on All Pods
// ---------------------------------------------------------------------------

describe('seccompProfile', () => {
  it.each(APPS)('deployment %s should have RuntimeDefault seccomp profile', (app) => {
    const deployment = getAppDeployment(app);
    const template = (deployment?.spec as Record<string, unknown>)?.template as Record<string, unknown>;
    const podSpec = template?.spec as Record<string, unknown>;
    const securityContext = podSpec?.securityContext as Record<string, unknown>;
    const seccomp = securityContext?.seccompProfile as Record<string, string>;

    expect(seccomp, `Missing seccompProfile in ${app}`).toBeDefined();
    expect(seccomp.type).toBe('RuntimeDefault');
  });
});

// ---------------------------------------------------------------------------
// 25. Ingress — API Only
// ---------------------------------------------------------------------------

describe('Ingress', () => {
  it('API should have an Ingress resource', () => {
    const ingresses = getResourcesByKind('Ingress');
    const apiIngress = ingresses.find(i => i.metadata?.name === 'api');
    expect(apiIngress).toBeDefined();
  });

  it('Ingress should enforce TLS', () => {
    const ingresses = getResourcesByKind('Ingress');
    const apiIngress = ingresses.find(i => i.metadata?.name === 'api');
    const spec = apiIngress?.spec as Record<string, unknown>;
    const tls = spec?.tls as Array<Record<string, unknown>>;
    expect(tls, 'Missing TLS config on Ingress').toBeDefined();
    expect(tls.length).toBeGreaterThan(0);
  });
});
