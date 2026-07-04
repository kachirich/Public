import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // All DB test files share one database; run them one at a time.
    fileParallelism: false,
  },
});
