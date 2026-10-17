import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  // Resolves the path aliases declared in tsconfig.json, including the ones
  // added by `nest g library`. Requires Vite 8, which ships this option.
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.spec.ts'],
    // mock-erp and dashboard are separate packages with their own tests.
    // Spread the defaults: a custom exclude replaces them, node_modules included.
    exclude: [...configDefaults.exclude, 'mock-erp/**', 'dashboard/**'],
  },
});
