import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['e2e/**/*.spec.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    globalSetup: ['./e2e/helpers/global-setup.ts'],
    setupFiles: ['./e2e/helpers/setup.ts'],
    reporters: ['verbose'],
    fileParallelism: false,
  },
});
