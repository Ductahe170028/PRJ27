// FROZEN: Advanced Mode tests. Excluded from `npm test` (vitest.config.ts) and run by
// `npm run test:advanced` (vitest.advanced.config.ts). One list for both configs, so
// a test is never in both or in neither.
//
// A file is here when it imports src/agent, src/sandbox or src/services/job-queue
// (directly or through ./agent-fixtures), or tests only that code. Files that use
// Advanced only to build an app for Standard HTTP checks stay in the main run:
// network-security.test.ts (clientKey, trust proxy, size limits, error shape) and
// standard-diagnostics.test.ts (Standard run files; FileRunDiagnostics only as a
// redaction reference), like ai.test.ts and http.test.ts.
export const ADVANCED_TESTS = [
  'apps/api/test/advanced-queue.test.ts',
  'apps/api/test/agent-token-budget.test.ts',
  'apps/api/test/code-agent.test.ts',
  'apps/api/test/code-contract.test.ts',
  'apps/api/test/code-validator-directives.test.ts',
  'apps/api/test/control-mapping.test.ts',
  'apps/api/test/create-agent.test.ts',
  'apps/api/test/deploy-config.test.ts',
  'apps/api/test/game-tester.test.ts',
  'apps/api/test/gameplay-requirements.test.ts',
  'apps/api/test/isolated-validator.test.ts',
  'apps/api/test/job-queue.test.ts',
  'apps/api/test/run-diagnostics.test.ts',
  'apps/api/test/sandbox-integration.test.ts',
  'apps/api/test/sandbox.test.ts',
  'apps/api/test/state-narrowing.test.ts',
  'apps/web/test/agent-stream.test.ts',
];
