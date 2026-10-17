import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // mock-erp is a separate package with its own tests (npm test in mock-erp/).
    // Spread the defaults: a custom exclude replaces them, node_modules included.
    exclude: [...configDefaults.exclude, 'mock-erp/**'],
    // AppModule needs PostgreSQL: TEST_DATABASE_URL or Docker (Testcontainers).
    globalSetup: ['./test/db/global-setup.ts'],
    hookTimeout: 120_000,
    testTimeout: 60_000,
  },
});
