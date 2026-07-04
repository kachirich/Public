import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // e2e and workers tests share one database; never run files in parallel.
    fileParallelism: false,
  },
});
