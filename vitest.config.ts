import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'tests/unit/**/*.test.ts',
      'tests/security/**/*.test.ts',
      'tests/rules/**/*.test.ts',
      'tests/auth/**/*.test.ts',
      'tests/integration/**/*.test.ts'
    ],
    testTimeout: 30000
  }
});
