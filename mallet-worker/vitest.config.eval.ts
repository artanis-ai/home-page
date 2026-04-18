import { defineConfig } from 'vitest/config'

// Eval config: runs only the labeled eval suite. Slow + LLM-expensive,
// invoked explicitly via `npm run eval`.
export default defineConfig({
  test: {
    include: ['src/**/__tests__/evals/*.eval.ts'],
    // Per-file budgets to avoid premature failure on slow LLM calls.
    testTimeout: 60_000,
    hookTimeout: 900_000, // beforeAll runs the full corpus
  },
})
