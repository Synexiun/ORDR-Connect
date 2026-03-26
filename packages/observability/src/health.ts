/**
 * @ordr/observability — Standardized health probes (liveness / readiness / startup)
 *
 * SOC2 A1.2 — Availability: automated health monitoring of all components.
 * ISO 27001 A.8.14 — Redundancy: health probes for failover decisions.
 * HIPAA §164.308(a)(7) — Contingency plan: detect degraded services.
 *
 * Kubernetes probe mapping:
 * - /health/live   → liveness()  — is the process alive?
 * - /health/ready  → readiness() — are all dependencies reachable?
 * - /health/startup → startup()  — has initialization completed?
 */

import type { HealthStatus, HealthCheckResult, HealthResponse } from './types.js';

// ─── Types ───────────────────────────────────────────────────────

export type HealthCheckFn = () => Promise<HealthCheckResult>;

// ─── Health Checker ──────────────────────────────────────────────

export class HealthChecker {
  private readonly checks: Map<string, HealthCheckFn>;
  private readonly startTime: number;
  private initializationComplete: boolean;

  constructor() {
    this.checks = new Map();
    this.startTime = Date.now();
    this.initializationComplete = false;
  }

  /**
   * Register a named health check for a dependency.
   * Each check is called during readiness probes.
   */
  addCheck(name: string, checker: HealthCheckFn): void {
    this.checks.set(name, checker);
  }

  /**
   * Mark initialization as complete.
   * Call after all services, connections, and dependencies are ready.
   */
  markReady(): void {
    this.initializationComplete = true;
  }

  /**
   * Liveness probe — is the process alive?
   * Always returns 200 if the process is running.
   * K8s uses this to decide whether to restart the pod.
   */
  async liveness(): Promise<HealthResponse> {
    return {
      status: 'healthy',
      checks: [],
      uptimeSeconds: this.getUptimeSeconds(),
    };
  }

  /**
   * Readiness probe — are all dependencies healthy?
   * Returns 200 only if ALL checks pass.
   * K8s uses this to decide whether to route traffic to this pod.
   */
  async readiness(): Promise<HealthResponse> {
    const results = await this.runAllChecks();
    const overallStatus = this.computeOverallStatus(results);

    return {
      status: overallStatus,
      checks: results,
      uptimeSeconds: this.getUptimeSeconds(),
    };
  }

  /**
   * Startup probe — has initialization completed?
   * Returns 200 only after markReady() has been called.
   * K8s uses this during initial boot to avoid premature liveness/readiness failures.
   */
  async startup(): Promise<HealthResponse> {
    const status: HealthStatus = this.initializationComplete ? 'healthy' : 'unhealthy';

    return {
      status,
      checks: [{
        name: 'initialization',
        status,
        message: this.initializationComplete ? 'Initialization complete' : 'Still initializing',
        durationMs: 0,
      }],
      uptimeSeconds: this.getUptimeSeconds(),
    };
  }

  // ── Internal ─────────────────────────────────────────────────

  private async runAllChecks(): Promise<HealthCheckResult[]> {
    const results: HealthCheckResult[] = [];

    for (const [name, checkFn] of this.checks) {
      const start = Date.now();
      try {
        const result = await checkFn();
        results.push(result);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Check failed';
        results.push({
          name,
          status: 'unhealthy',
          message,
          durationMs: Date.now() - start,
        });
      }
    }

    return results;
  }

  private computeOverallStatus(checks: readonly HealthCheckResult[]): HealthStatus {
    if (checks.length === 0) {
      return 'healthy';
    }

    const hasUnhealthy = checks.some((c) => c.status === 'unhealthy');
    if (hasUnhealthy) return 'unhealthy';

    const hasDegraded = checks.some((c) => c.status === 'degraded');
    if (hasDegraded) return 'degraded';

    return 'healthy';
  }

  private getUptimeSeconds(): number {
    return Math.floor((Date.now() - this.startTime) / 1000);
  }

  /**
   * Returns the number of registered checks (for testing/introspection).
   */
  getCheckCount(): number {
    return this.checks.size;
  }

  /**
   * Returns the names of all registered checks (for testing/introspection).
   */
  getCheckNames(): readonly string[] {
    return [...this.checks.keys()];
  }
}
