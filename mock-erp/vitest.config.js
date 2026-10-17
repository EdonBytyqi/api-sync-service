import { defineConfig } from 'vitest/config';

// Own config so vitest does not pick up the NestJS one in the parent folder.
export default defineConfig({
  test: {
    root: import.meta.dirname,
    include: ['test/**/*.test.js'],
  },
});
