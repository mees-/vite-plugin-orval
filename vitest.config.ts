import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    testTimeout: 60_000,
    hookTimeout: 30_000,
    // Orval writes to disk; keep runs from racing over the same fixtures.
    fileParallelism: false,
  },
})
