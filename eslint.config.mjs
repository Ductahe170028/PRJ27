import parser from '@typescript-eslint/parser';
export default [
  { ignores: ['**/node_modules/**', '**/dist/**', '**/public/runtime/**', 'test-results/**', 'playwright-report/**', '.local-diagnostics/**'] },
  {
    files: ['**/*.{ts,tsx,mjs}'],
    languageOptions: { parser, ecmaVersion: 2022, sourceType: 'module', parserOptions: { ecmaFeatures: { jsx: true } } },
    // TypeScript strict/noUnusedLocals cover type/name/unused checks.
    rules: { 'no-eval': 'error', 'no-new-func': 'error', 'no-implied-eval': 'error', 'no-debugger': 'error',
      'no-duplicate-case': 'error', 'no-dupe-else-if': 'error', 'no-unreachable': 'error', 'no-unsafe-finally': 'error',
      'valid-typeof': 'error', 'constructor-super': 'error', 'no-async-promise-executor': 'error' },
  },
];
