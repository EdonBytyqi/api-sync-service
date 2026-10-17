import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // mock-erp and dashboard are separate packages with their own tests.
    // Spread the defaults: a custom exclude replaces them, node_modules included.
    exclude: [...configDefaults.exclude, 'mock-erp/**', 'dashboard/**'],
    // AppModule needs PostgreSQL: TEST_DATABASE_URL or Docker (Testcontainers).
    globalSetup: ['./test/db/global-setup.ts'],
    hookTimeout: 120_000,
    testTimeout: 60_000,
  },
});
