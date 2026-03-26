import { defineConfig } from 'vitest/config';
import path from 'node:path';

/**
 * Vitest config — Integration tests only.
 *
 * Longer timeouts, separate include pattern, same resolve aliases
 * as the root config so @ordr/* packages resolve to their TS source.
 */

const packages = [
  'ai',
  'analytics',
  'audit',
  'auth',
  'channels',
  'compliance',
  'core',
  'crypto',
  'db',
  'decision-engine',
  'events',
  'graph',
  'observability',
  'sdk',
] as const;

const aliases: Record<string, string> = {};
for (const pkg of packages) {
  aliases[`@ordr/${pkg}`] = path.resolve(__dirname, `packages/${pkg}/src/index.ts`);
}
// Resolve zod from SDK's dependencies for integration tests
aliases['zod'] = path.resolve(__dirname, 'packages/sdk/node_modules/zod/index.js');

export default defineConfig({
  resolve: {
    alias: aliases,
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    testTimeout: 60_000,
    hookTimeout: 30_000,
    pool: 'forks',
    sequence: {
      shuffle: false,
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json'],
      thresholds: {
        lines: 60,
        functions: 60,
        branches: 50,
        statements: 60,
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
  },
});
