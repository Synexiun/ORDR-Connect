/**
 * ORDR-Connect — CI/CD Configuration Tests
 * SOC2/ISO27001/HIPAA: Validate all workflow files programmatically
 *
 * Ensures compliance gates, security scanning, and deployment rules
 * are correctly defined in GitHub Actions workflows.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse as parseYAML } from 'yaml';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ROOT = resolve(__dirname, '..', '..');
const WORKFLOWS = resolve(ROOT, '.github', 'workflows');

interface WorkflowFile {
  name: string;
  path: string;
  raw: string;
  parsed: Record<string, unknown>;
}

function loadWorkflow(filename: string): WorkflowFile {
  const filepath = resolve(WORKFLOWS, filename);
  const raw = readFileSync(filepath, 'utf-8');
  const parsed = parseYAML(raw) as Record<string, unknown>;
  return { name: filename, path: filepath, raw, parsed };
}

function getJobs(wf: WorkflowFile): Record<string, Record<string, unknown>> {
  return (wf.parsed['jobs'] ?? {}) as Record<string, Record<string, unknown>>;
}

function getOn(wf: WorkflowFile): Record<string, unknown> {
  const trigger = wf.parsed['on'] ?? wf.parsed[true as unknown as string];
  return (typeof trigger === 'object' && trigger !== null ? trigger : {}) as Record<string, unknown>;
}

function getAllStepUses(wf: WorkflowFile): string[] {
  const jobs = getJobs(wf);
  const uses: string[] = [];
  for (const job of Object.values(jobs)) {
    const steps = (job['steps'] ?? []) as Array<Record<string, unknown>>;
    for (const step of steps) {
      if (typeof step['uses'] === 'string') {
        uses.push(step['uses']);
      }
    }
  }
  return uses;
}

function getAllStepRuns(wf: WorkflowFile): string[] {
  const jobs = getJobs(wf);
  const runs: string[] = [];
  for (const job of Object.values(jobs)) {
    const steps = (job['steps'] ?? []) as Array<Record<string, unknown>>;
    for (const step of steps) {
      if (typeof step['run'] === 'string') {
        runs.push(step['run']);
      }
    }
  }
  return runs;
}

// ---------------------------------------------------------------------------
// Load all workflows
// ---------------------------------------------------------------------------

let ci: WorkflowFile;
let security: WorkflowFile;
let deployStagingWf: WorkflowFile;
let deployProductionWf: WorkflowFile;
let containerScan: WorkflowFile;

beforeAll(() => {
  ci = loadWorkflow('ci.yml');
  security = loadWorkflow('security.yml');
  deployStagingWf = loadWorkflow('deploy-staging.yml');
  deployProductionWf = loadWorkflow('deploy-production.yml');
  containerScan = loadWorkflow('container-scan.yml');
});

// ===========================================================================
// 1. YAML Validity
// ===========================================================================

describe('YAML Validity', () => {
  const workflowFiles = [
    'ci.yml',
    'security.yml',
    'deploy-staging.yml',
    'deploy-production.yml',
    'container-scan.yml',
  ];

  it.each(workflowFiles)('%s exists', (filename) => {
    expect(existsSync(resolve(WORKFLOWS, filename))).toBe(true);
  });

  it.each(workflowFiles)('%s is valid YAML', (filename) => {
    const raw = readFileSync(resolve(WORKFLOWS, filename), 'utf-8');
    expect(() => parseYAML(raw)).not.toThrow();
  });

  it.each(workflowFiles)('%s has a name field', (filename) => {
    const raw = readFileSync(resolve(WORKFLOWS, filename), 'utf-8');
    const parsed = parseYAML(raw) as Record<string, unknown>;
    expect(parsed['name']).toBeDefined();
    expect(typeof parsed['name']).toBe('string');
  });

  it.each(workflowFiles)('%s has jobs defined', (filename) => {
    const raw = readFileSync(resolve(WORKFLOWS, filename), 'utf-8');
    const parsed = parseYAML(raw) as Record<string, unknown>;
    expect(parsed['jobs']).toBeDefined();
    expect(Object.keys(parsed['jobs'] as object).length).toBeGreaterThan(0);
  });
});

// ===========================================================================
// 2. CI Workflow
// ===========================================================================

describe('CI Workflow', () => {
  it('triggers on pull_request to main, staging, develop', () => {
    const on = getOn(ci);
    const pr = on['pull_request'] as Record<string, unknown>;
    expect(pr).toBeDefined();
    const branches = pr['branches'] as string[];
    expect(branches).toContain('main');
    expect(branches).toContain('staging');
    expect(branches).toContain('develop');
  });

  it('has lint job', () => {
    const jobs = getJobs(ci);
    expect(jobs['lint']).toBeDefined();
  });

  it('has typecheck job', () => {
    const jobs = getJobs(ci);
    expect(jobs['typecheck']).toBeDefined();
  });

  it('has test job', () => {
    const jobs = getJobs(ci);
    expect(jobs['test']).toBeDefined();
  });

  it('has ci-gate job that depends on all checks', () => {
    const jobs = getJobs(ci);
    expect(jobs['ci-gate']).toBeDefined();
    const needs = jobs['ci-gate']!['needs'] as string[];
    expect(needs).toContain('lint');
    expect(needs).toContain('typecheck');
    expect(needs).toContain('test');
  });

  it('ci-gate fails if any dependency fails', () => {
    const jobs = getJobs(ci);
    const gate = jobs['ci-gate']!;
    const steps = gate['steps'] as Array<Record<string, unknown>>;
    const checkStep = steps.find((s) => typeof s['run'] === 'string' && (s['run'] as string).includes('exit 1'));
    expect(checkStep).toBeDefined();
  });

  it('test job uploads coverage artifacts', () => {
    const jobs = getJobs(ci);
    const testSteps = (jobs['test']!['steps'] ?? []) as Array<Record<string, unknown>>;
    const uploadStep = testSteps.find(
      (s) => typeof s['uses'] === 'string' && (s['uses'] as string).includes('upload-artifact')
    );
    expect(uploadStep).toBeDefined();
  });

  it('uses pnpm install --frozen-lockfile', () => {
    const runs = getAllStepRuns(ci);
    const installStep = runs.find((r) => r.includes('pnpm install --frozen-lockfile'));
    expect(installStep).toBeDefined();
  });

  it('never uses npm or yarn', () => {
    const runs = getAllStepRuns(ci);
    for (const run of runs) {
      expect(run).not.toMatch(/\bnpm (install|ci|run)\b/);
      expect(run).not.toMatch(/\byarn\b/);
    }
  });
});

// ===========================================================================
// 3. Security Workflow
// ===========================================================================

describe('Security Workflow', () => {
  it('triggers on pull_request', () => {
    const on = getOn(security);
    expect(on['pull_request']).toBeDefined();
  });

  it('has weekly schedule', () => {
    const on = getOn(security);
    const schedule = on['schedule'] as Array<Record<string, string>>;
    expect(schedule).toBeDefined();
    expect(schedule.length).toBeGreaterThan(0);
    expect(schedule[0]!['cron']).toBeDefined();
  });

  it('includes dependency scan (Trivy)', () => {
    const jobs = getJobs(security);
    expect(jobs['dependency-scan']).toBeDefined();
    const uses = getAllStepUses(security);
    const trivyStep = uses.find((u) => u.includes('trivy'));
    expect(trivyStep).toBeDefined();
  });

  it('includes secret scan (gitleaks)', () => {
    const jobs = getJobs(security);
    expect(jobs['secret-scan']).toBeDefined();
    const uses = getAllStepUses(security);
    const gitleaksStep = uses.find((u) => u.includes('gitleaks'));
    expect(gitleaksStep).toBeDefined();
  });

  it('includes SAST (Semgrep)', () => {
    const jobs = getJobs(security);
    expect(jobs['sast']).toBeDefined();
    const runs = getAllStepRuns(security);
    const semgrepStep = runs.find((r) => r.includes('semgrep'));
    expect(semgrepStep).toBeDefined();
  });

  it('includes SBOM generation', () => {
    const jobs = getJobs(security);
    expect(jobs['sbom']).toBeDefined();
  });

  it('Trivy fails on critical and high CVEs', () => {
    const jobs = getJobs(security);
    const depScan = jobs['dependency-scan']!;
    const steps = (depScan['steps'] ?? []) as Array<Record<string, unknown>>;
    const trivyStep = steps.find(
      (s) => typeof s['uses'] === 'string' && (s['uses'] as string).includes('trivy')
    );
    expect(trivyStep).toBeDefined();
    const withConfig = trivyStep!['with'] as Record<string, string>;
    expect(withConfig['exit-code']).toBe('1');
    expect(withConfig['severity']).toContain('CRITICAL');
    expect(withConfig['severity']).toContain('HIGH');
  });

  it('Semgrep uses OWASP rules', () => {
    const runs = getAllStepRuns(security);
    const semgrepRun = runs.find((r) => r.includes('semgrep'));
    expect(semgrepRun).toBeDefined();
    expect(semgrepRun).toContain('owasp-top-ten');
  });

  it('Semgrep uses TypeScript rules', () => {
    const runs = getAllStepRuns(security);
    const semgrepRun = runs.find((r) => r.includes('semgrep'));
    expect(semgrepRun).toBeDefined();
    expect(semgrepRun).toContain('typescript');
  });

  it('has security-gate job requiring all scans', () => {
    const jobs = getJobs(security);
    expect(jobs['security-gate']).toBeDefined();
    const needs = jobs['security-gate']!['needs'] as string[];
    expect(needs).toContain('dependency-scan');
    expect(needs).toContain('secret-scan');
    expect(needs).toContain('sast');
    expect(needs).toContain('sbom');
  });
});

// ===========================================================================
// 4. SBOM Format
// ===========================================================================

describe('SBOM Configuration', () => {
  it('generates CycloneDX format', () => {
    const runs = getAllStepRuns(security);
    const sbomRun = runs.find((r) => r.includes('cyclonedx'));
    expect(sbomRun).toBeDefined();
    expect(sbomRun).toContain('JSON');
  });

  it('uploads SBOM as artifact', () => {
    const jobs = getJobs(security);
    const sbomJob = jobs['sbom']!;
    const steps = (sbomJob['steps'] ?? []) as Array<Record<string, unknown>>;
    const uploadStep = steps.find(
      (s) => typeof s['uses'] === 'string' && (s['uses'] as string).includes('upload-artifact')
    );
    expect(uploadStep).toBeDefined();
    const withConfig = uploadStep!['with'] as Record<string, string>;
    expect(withConfig['name']).toContain('sbom');
  });
});

// ===========================================================================
// 5. Deploy Workflows — Branch Rules
// ===========================================================================

describe('Deploy Staging Workflow', () => {
  it('triggers on push to develop', () => {
    const on = getOn(deployStagingWf);
    const push = on['push'] as Record<string, unknown>;
    expect(push).toBeDefined();
    const branches = push['branches'] as string[];
    expect(branches).toContain('develop');
    expect(branches).not.toContain('main');
  });

  it('runs CI checks before deploy', () => {
    const jobs = getJobs(deployStagingWf);
    expect(jobs['ci']).toBeDefined();
  });

  it('builds Docker image', () => {
    const uses = getAllStepUses(deployStagingWf);
    const buildStep = uses.find((u) => u.includes('build-push-action'));
    expect(buildStep).toBeDefined();
  });

  it('pushes to ghcr.io', () => {
    expect(deployStagingWf.raw).toContain('ghcr.io');
  });

  it('deploys to staging namespace', () => {
    const runs = getAllStepRuns(deployStagingWf);
    const deployRun = runs.find((r) => r.includes('ordr-staging'));
    expect(deployRun).toBeDefined();
  });

  it('runs smoke tests', () => {
    const runs = getAllStepRuns(deployStagingWf);
    const smokeRun = runs.find((r) => r.includes('health') || r.includes('smoke'));
    expect(smokeRun).toBeDefined();
  });

  it('has Slack notification', () => {
    const uses = getAllStepUses(deployStagingWf);
    const slackStep = uses.find((u) => u.includes('slack'));
    expect(slackStep).toBeDefined();
  });
});

describe('Deploy Production Workflow', () => {
  it('triggers on push to main only', () => {
    const on = getOn(deployProductionWf);
    const push = on['push'] as Record<string, unknown>;
    expect(push).toBeDefined();
    const branches = push['branches'] as string[];
    expect(branches).toContain('main');
    expect(branches).not.toContain('develop');
    expect(branches).not.toContain('staging');
  });

  it('requires environment approval', () => {
    const jobs = getJobs(deployProductionWf);
    const deploy = jobs['deploy']!;
    expect(deploy['environment']).toBeDefined();
    const env = deploy['environment'] as Record<string, string>;
    expect(env['name']).toBe('production');
  });

  it('runs CI and security checks before deploy', () => {
    const jobs = getJobs(deployProductionWf);
    expect(jobs['ci']).toBeDefined();
    expect(jobs['security']).toBeDefined();
  });

  it('signs container images with cosign', () => {
    const uses = getAllStepUses(deployProductionWf);
    const cosignStep = uses.find((u) => u.includes('cosign'));
    expect(cosignStep).toBeDefined();
    const runs = getAllStepRuns(deployProductionWf);
    const signRun = runs.find((r) => r.includes('cosign sign'));
    expect(signRun).toBeDefined();
  });

  it('implements blue-green deployment', () => {
    const runs = getAllStepRuns(deployProductionWf);
    const blueGreenRun = runs.find((r) => r.includes('blue') && r.includes('green'));
    expect(blueGreenRun).toBeDefined();
  });

  it('has health check verification', () => {
    const jobs = getJobs(deployProductionWf);
    const deploy = jobs['deploy']!;
    const steps = (deploy['steps'] ?? []) as Array<Record<string, unknown>>;
    const healthStep = steps.find(
      (s) => typeof s['name'] === 'string' && (s['name'] as string).toLowerCase().includes('health')
    );
    expect(healthStep).toBeDefined();
  });

  it('has automatic rollback on failure', () => {
    const jobs = getJobs(deployProductionWf);
    const deploy = jobs['deploy']!;
    const steps = (deploy['steps'] ?? []) as Array<Record<string, unknown>>;
    const rollbackStep = steps.find(
      (s) => typeof s['name'] === 'string' && (s['name'] as string).toLowerCase().includes('rollback')
    );
    expect(rollbackStep).toBeDefined();
    expect(rollbackStep!['if']).toBeDefined();
    expect(String(rollbackStep!['if'])).toContain('failure()');
  });

  it('has PagerDuty notification on failure', () => {
    const runs = getAllStepRuns(deployProductionWf);
    const pagerdutyRun = runs.find((r) => r.includes('pagerduty'));
    expect(pagerdutyRun).toBeDefined();
  });
});

// ===========================================================================
// 6. Container Scan Workflow
// ===========================================================================

describe('Container Scan Workflow', () => {
  it('runs on weekly schedule', () => {
    const on = getOn(containerScan);
    const schedule = on['schedule'] as Array<Record<string, string>>;
    expect(schedule).toBeDefined();
    expect(schedule.length).toBeGreaterThan(0);
    expect(schedule[0]!['cron']).toBeDefined();
  });

  it('scans base images', () => {
    const jobs = getJobs(containerScan);
    const scanJob = jobs['scan-base-images']!;
    const strategy = scanJob['strategy'] as Record<string, Record<string, string[]>>;
    expect(strategy['matrix']['image']).toBeDefined();
    expect(strategy['matrix']['image'].length).toBeGreaterThan(0);
  });

  it('creates GitHub issue for findings', () => {
    const uses = getAllStepUses(containerScan);
    const scriptStep = uses.find((u) => u.includes('github-script'));
    expect(scriptStep).toBeDefined();
    expect(containerScan.raw).toContain('issues.create');
  });
});

// ===========================================================================
// 7. Node Version Consistency
// ===========================================================================

describe('Node Version', () => {
  const workflowsWithNode = ['ci.yml', 'security.yml', 'deploy-staging.yml', 'deploy-production.yml'];

  it.each(workflowsWithNode)('%s uses Node 22', (filename) => {
    const raw = readFileSync(resolve(WORKFLOWS, filename), 'utf-8');
    const parsed = parseYAML(raw) as Record<string, unknown>;
    const env = parsed['env'] as Record<string, string> | undefined;
    if (env?.['NODE_VERSION'] !== undefined) {
      expect(env['NODE_VERSION']).toBe('22');
    }
    // Also check setup-node steps
    expect(raw).toContain('22');
  });
});

// ===========================================================================
// 8. pnpm Consistency
// ===========================================================================

describe('pnpm Consistency', () => {
  const allWorkflows = [
    'ci.yml',
    'security.yml',
    'deploy-staging.yml',
    'deploy-production.yml',
  ];

  it.each(allWorkflows)('%s uses pnpm or delegates to CI workflow (not npm/yarn)', (filename) => {
    const raw = readFileSync(resolve(WORKFLOWS, filename), 'utf-8');
    // Workflow should either reference pnpm directly or delegate to
    // a reusable CI workflow that does (deploy workflows delegate via `uses: ./.github/workflows/ci.yml`)
    const usesPnpmDirectly = raw.includes('pnpm');
    const delegatesToCi = raw.includes('./.github/workflows/ci.yml');
    expect(usesPnpmDirectly || delegatesToCi).toBe(true);
    // Should NOT have npm install/run/ci commands (excluding pnpm/npx references)
    const lines = raw.split('\n');
    for (const line of lines) {
      if (line.includes('npm') && !line.includes('pnpm') && !line.includes('npx') && !line.includes('cyclonedx-npm')) {
        expect(line).not.toMatch(/\bnpm (install|ci|run|test)\b/);
      }
    }
  });
});

// ===========================================================================
// 9. Timeout Rules
// ===========================================================================

describe('Timeout Configuration', () => {
  const allWorkflows = [
    'ci.yml',
    'security.yml',
    'deploy-staging.yml',
    'deploy-production.yml',
    'container-scan.yml',
  ];

  it.each(allWorkflows)('%s has timeout-minutes on all jobs', (filename) => {
    const raw = readFileSync(resolve(WORKFLOWS, filename), 'utf-8');
    const parsed = parseYAML(raw) as Record<string, unknown>;
    const jobs = parsed['jobs'] as Record<string, Record<string, unknown>>;
    for (const [jobName, job] of Object.entries(jobs)) {
      // Skip reusable workflow calls (they have 'uses' not 'steps')
      if (job['uses'] !== undefined) continue;
      expect(job['timeout-minutes']).toBeDefined();
      expect(typeof job['timeout-minutes']).toBe('number');
      expect(job['timeout-minutes'] as number).toBeGreaterThan(0);
      expect(job['timeout-minutes'] as number).toBeLessThanOrEqual(30);
    }
  });
});

// ===========================================================================
// 10. No Hardcoded Secrets
// ===========================================================================

describe('No Hardcoded Secrets', () => {
  const allWorkflows = [
    'ci.yml',
    'security.yml',
    'deploy-staging.yml',
    'deploy-production.yml',
    'container-scan.yml',
  ];

  it.each(allWorkflows)('%s has no hardcoded secrets', (filename) => {
    const raw = readFileSync(resolve(WORKFLOWS, filename), 'utf-8');
    // Should not have hardcoded tokens, keys, passwords
    expect(raw).not.toMatch(/ghp_[A-Za-z0-9]{36}/);
    expect(raw).not.toMatch(/AKIA[A-Z0-9]{16}/);
    expect(raw).not.toMatch(/-----BEGIN (RSA |EC )?PRIVATE KEY-----/);
    expect(raw).not.toMatch(/password:\s*['"][^${}]+['"]/i);
  });

  it.each(allWorkflows)('%s uses secrets.* for sensitive values', (filename) => {
    const raw = readFileSync(resolve(WORKFLOWS, filename), 'utf-8');
    // If it references any secret-like values, they should use ${{ secrets.* }}
    const secretRefs = raw.match(/\$\{\{\s*secrets\.[A-Z_]+\s*\}\}/g) ?? [];
    // deploy workflows must reference secrets
    if (filename.includes('deploy')) {
      expect(secretRefs.length).toBeGreaterThan(0);
    }
  });
});

// ===========================================================================
// 11. Action Pinning
// ===========================================================================

describe('Action Version Pinning', () => {
  const allWorkflows = [
    'ci.yml',
    'security.yml',
    'deploy-staging.yml',
    'deploy-production.yml',
    'container-scan.yml',
  ];

  it.each(allWorkflows)('%s pins actions with SHA hashes', (filename) => {
    const raw = readFileSync(resolve(WORKFLOWS, filename), 'utf-8');
    const parsed = parseYAML(raw) as Record<string, unknown>;
    const jobs = parsed['jobs'] as Record<string, Record<string, unknown>>;

    for (const [, job] of Object.entries(jobs)) {
      if (job['uses'] !== undefined) continue; // reusable workflow ref
      const steps = (job['steps'] ?? []) as Array<Record<string, unknown>>;
      for (const step of steps) {
        if (typeof step['uses'] === 'string') {
          const uses = step['uses'] as string;
          // Skip local workflow references
          if (uses.startsWith('./')) continue;
          // Must contain @ followed by SHA (40 hex chars)
          expect(uses).toMatch(/@[a-f0-9]{40}/);
        }
      }
    }
  });
});

// ===========================================================================
// 12. Coverage Thresholds Match vitest.config.ts
// ===========================================================================

describe('Coverage Thresholds', () => {
  it('vitest.config.ts enforces 80% line coverage', () => {
    const vitestConfig = readFileSync(resolve(ROOT, 'vitest.config.ts'), 'utf-8');
    expect(vitestConfig).toContain('lines: 80');
  });

  it('vitest.config.ts enforces 80% function coverage', () => {
    const vitestConfig = readFileSync(resolve(ROOT, 'vitest.config.ts'), 'utf-8');
    expect(vitestConfig).toContain('functions: 80');
  });

  it('vitest.config.ts enforces 80% statement coverage', () => {
    const vitestConfig = readFileSync(resolve(ROOT, 'vitest.config.ts'), 'utf-8');
    expect(vitestConfig).toContain('statements: 80');
  });

  it('CI workflow runs test:coverage', () => {
    const runs = getAllStepRuns(ci);
    const coverageRun = runs.find((r) => r.includes('test:coverage'));
    expect(coverageRun).toBeDefined();
  });
});

// ===========================================================================
// 13. Pre-commit Hooks
// ===========================================================================

describe('Pre-commit Configuration', () => {
  it('.husky/pre-commit exists', () => {
    expect(existsSync(resolve(ROOT, '.husky', 'pre-commit'))).toBe(true);
  });

  it('.husky/pre-commit runs lint-staged', () => {
    const hook = readFileSync(resolve(ROOT, '.husky', 'pre-commit'), 'utf-8');
    expect(hook).toContain('lint-staged');
  });

  it('.lintstagedrc.json exists', () => {
    expect(existsSync(resolve(ROOT, '.lintstagedrc.json'))).toBe(true);
  });

  it('.lintstagedrc.json runs eslint on TypeScript files', () => {
    const raw = readFileSync(resolve(ROOT, '.lintstagedrc.json'), 'utf-8');
    const config = JSON.parse(raw) as Record<string, string[]>;
    const tsCommands = config['*.{ts,tsx}'] ?? [];
    const hasEslint = tsCommands.some((cmd) => cmd.includes('eslint'));
    expect(hasEslint).toBe(true);
  });

  it('.lintstagedrc.json runs prettier on TypeScript files', () => {
    const raw = readFileSync(resolve(ROOT, '.lintstagedrc.json'), 'utf-8');
    const config = JSON.parse(raw) as Record<string, string[]>;
    const tsCommands = config['*.{ts,tsx}'] ?? [];
    const hasPrettier = tsCommands.some((cmd) => cmd.includes('prettier'));
    expect(hasPrettier).toBe(true);
  });

  it('.lintstagedrc.json runs gitleaks on all files', () => {
    const raw = readFileSync(resolve(ROOT, '.lintstagedrc.json'), 'utf-8');
    const config = JSON.parse(raw) as Record<string, string[]>;
    const allCommands = config['*'] ?? [];
    const hasGitleaks = allCommands.some((cmd) => cmd.includes('gitleaks'));
    expect(hasGitleaks).toBe(true);
  });
});

// ===========================================================================
// 14. Secret Scan Configuration
// ===========================================================================

describe('Secret Scan Config (.gitleaks.toml)', () => {
  it('.gitleaks.toml exists', () => {
    expect(existsSync(resolve(ROOT, '.gitleaks.toml'))).toBe(true);
  });

  it('blocks common secret patterns', () => {
    const raw = readFileSync(resolve(ROOT, '.gitleaks.toml'), 'utf-8');
    expect(raw).toContain('aws');
    expect(raw).toContain('private-key');
    expect(raw).toContain('jwt');
    expect(raw).toContain('database');
    expect(raw).toContain('generic-api-key');
  });

  it('allows test fixtures', () => {
    const raw = readFileSync(resolve(ROOT, '.gitleaks.toml'), 'utf-8');
    expect(raw).toContain('test');
    expect(raw).toContain('allowlist');
  });

  it('uses default rules as base', () => {
    const raw = readFileSync(resolve(ROOT, '.gitleaks.toml'), 'utf-8');
    expect(raw).toContain('useDefault = true');
  });
});

// ===========================================================================
// 15. Branch Protection
// ===========================================================================

describe('Branch Protection Rules', () => {
  it('production deploy only from main', () => {
    const on = getOn(deployProductionWf);
    const push = on['push'] as Record<string, string[]>;
    expect(push['branches']).toEqual(['main']);
  });

  it('staging deploy only from develop', () => {
    const on = getOn(deployStagingWf);
    const push = on['push'] as Record<string, string[]>;
    expect(push['branches']).toEqual(['develop']);
  });

  it('CI runs on all protected branches', () => {
    const on = getOn(ci);
    const pr = on['pull_request'] as Record<string, string[]>;
    expect(pr['branches']).toContain('main');
    expect(pr['branches']).toContain('staging');
    expect(pr['branches']).toContain('develop');
  });
});

// ===========================================================================
// 16. Root package.json Scripts
// ===========================================================================

describe('Root package.json Scripts', () => {
  let pkg: Record<string, unknown>;

  beforeAll(() => {
    const raw = readFileSync(resolve(ROOT, 'package.json'), 'utf-8');
    pkg = JSON.parse(raw) as Record<string, unknown>;
  });

  it('has lint script', () => {
    const scripts = pkg['scripts'] as Record<string, string>;
    expect(scripts['lint']).toBeDefined();
  });

  it('has typecheck script', () => {
    const scripts = pkg['scripts'] as Record<string, string>;
    expect(scripts['typecheck']).toBeDefined();
  });

  it('has test script', () => {
    const scripts = pkg['scripts'] as Record<string, string>;
    expect(scripts['test']).toBeDefined();
  });

  it('has test:ci script', () => {
    const scripts = pkg['scripts'] as Record<string, string>;
    expect(scripts['test:ci']).toBeDefined();
    expect(scripts['test:ci']).toContain('--reporter=verbose');
  });

  it('has build script', () => {
    const scripts = pkg['scripts'] as Record<string, string>;
    expect(scripts['build']).toBeDefined();
  });

  it('has security:scan script', () => {
    const scripts = pkg['scripts'] as Record<string, string>;
    expect(scripts['security:scan']).toBeDefined();
  });

  it('has prepare script for husky', () => {
    const scripts = pkg['scripts'] as Record<string, string>;
    expect(scripts['prepare']).toBeDefined();
    expect(scripts['prepare']).toContain('husky');
  });
});

// ===========================================================================
// 17. Permissions
// ===========================================================================

describe('Workflow Permissions', () => {
  it('CI workflow has minimal permissions', () => {
    const perms = ci.parsed['permissions'] as Record<string, string>;
    expect(perms).toBeDefined();
    expect(perms['contents']).toBe('read');
  });

  it('Security workflow has security-events write for SARIF', () => {
    const perms = security.parsed['permissions'] as Record<string, string>;
    expect(perms).toBeDefined();
    expect(perms['security-events']).toBe('write');
  });

  it('Deploy workflows have packages write for GHCR', () => {
    const stagingPerms = deployStagingWf.parsed['permissions'] as Record<string, string>;
    const prodPerms = deployProductionWf.parsed['permissions'] as Record<string, string>;
    expect(stagingPerms['packages']).toBe('write');
    expect(prodPerms['packages']).toBe('write');
  });
});

// ===========================================================================
// 18. Concurrency Controls
// ===========================================================================

describe('Concurrency Controls', () => {
  it('CI workflow cancels in-progress runs', () => {
    const concurrency = ci.parsed['concurrency'] as Record<string, unknown>;
    expect(concurrency).toBeDefined();
    expect(concurrency['cancel-in-progress']).toBe(true);
  });

  it('Production deploy does NOT cancel in-progress', () => {
    const concurrency = deployProductionWf.parsed['concurrency'] as Record<string, unknown>;
    expect(concurrency).toBeDefined();
    expect(concurrency['cancel-in-progress']).toBe(false);
  });
});
