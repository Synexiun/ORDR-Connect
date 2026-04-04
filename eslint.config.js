import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import security from 'eslint-plugin-security';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ['*.js', '*.mjs', '*.cjs'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    plugins: { security },
    rules: {
      // === SECURITY RULES (SOC2/ISO27001/HIPAA) ===
      'security/detect-buffer-noassert': 'error',
      'security/detect-child-process': 'error',
      'security/detect-disable-mustache-escape': 'error',
      'security/detect-eval-with-expression': 'error',
      'security/detect-new-buffer': 'error',
      'security/detect-no-csrf-before-method-override': 'error',
      'security/detect-non-literal-fs-filename': 'warn',
      'security/detect-non-literal-regexp': 'warn',
      'security/detect-non-literal-require': 'error',
      // detect-object-injection produces high false-positive rate on legitimate
      // property access patterns (obj[key]) in TypeScript — disabled in favour of
      // noPropertyAccessFromIndexSignature in tsconfig and manual audit.
      'security/detect-object-injection': 'off',
      'security/detect-possible-timing-attacks': 'error',
      'security/detect-pseudoRandomBytes': 'error',
      'security/detect-unsafe-regex': 'error',

      // === TYPESCRIPT STRICT ===
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/strict-boolean-expressions': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      // Allow async functions in JSX event handlers (onClick={async () => ...})
      // which is standard React pattern; other void-return contexts remain checked.
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { attributes: false } },
      ],
      '@typescript-eslint/require-await': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // Allow numbers in template literals (essential for SVG path math in charts)
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],

      // === CODE QUALITY ===
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'prefer-const': 'error',
      'no-var': 'error',
      eqeqeq: ['error', 'always'],
    },
  },
  {
    // Test files: relax rules that are impractical for test assertions.
    // Non-null assertions in expect() calls are the idiomatic way to satisfy
    // noUncheckedIndexedAccess in strict mode without bloating test logic.
    files: ['**/__tests__/**/*.{ts,tsx}', '**/*.test.{ts,tsx}', '**/*.spec.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'coverage/**',
      'Tools/**',
      'Data/**',
      'Research/**',
      'eslint.config.js',
      '**/*.config.ts',
      '**/*.config.js',
      // Package test files are excluded from package tsconfigs and can't be
      // linted with typed rules without per-package tsconfig.test.json.
      // App test files are handled by the project service (nearest tsconfig).
      'packages/*/src/__tests__/**',
    ],
  },
);
