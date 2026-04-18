import { defineConfig } from 'vitest/config'

// Default vitest config: runs unit + integration tests, excludes the
// eval suite (which is slow + costs OpenAI calls — see vitest.config.eval.ts).
export default defineConfig({
  test: {
    include: ['src/**/*.{test,spec}.ts'],
    exclude: ['node_modules/**', 'src/**/__tests__/evals/**'],
  },
})
