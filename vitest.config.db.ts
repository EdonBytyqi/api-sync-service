import { configDefaults, defineConfig } from 'vitest/config';

// Tests that need PostgreSQL: TEST_DATABASE_URL or Docker (Testcontainers).
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.db-spec.ts'],
    exclude: [...configDefaults.exclude, 'mock-erp/**', 'dashboard/**'],
    globalSetup: ['./test/db/global-setup.ts'],
    hookTimeout: 120_000, // first container start may pull the image
    testTimeout: 30_000,
  },
});
