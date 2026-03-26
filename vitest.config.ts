import { defineConfig } from 'vitest/config';
import path from 'node:path';

/**
 * Resolve workspace packages to their TypeScript source so vitest
 * never depends on a stale dist/ build.
 */
const packages = [
  'ai',
  'analytics',
  'audit',
  'auth',
  'billing',
  'channels',
  'compliance',
  'core',
  'crypto',
  'db',
  'decision-engine',
  'events',
  'graph',
  'integrations',
  'observability',
  'realtime',
  'scheduler',
  'sdk',
  'search',
  'workflow',
] as const;

const aliases: Record<string, string> = {};
for (const pkg of packages) {
  aliases[`@ordr/${pkg}`] = path.resolve(__dirname, `packages/${pkg}/src/index.ts`);
}

export default defineConfig({
  resolve: {
    alias: aliases,
  },
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
      },
      exclude: [
        'node_modules/**',
        'dist/**',
        'Tools/**',
        'Data/**',
        'Research/**',
        '**/*.config.*',
        '**/*.d.ts',
      ],
    },
    exclude: ['**/node_modules/**', '**/dist/**', 'Tools/**', 'tests/integration/**'],
    testTimeout: 30000,
  },
});
