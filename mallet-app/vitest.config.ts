import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    exclude: ['e2e/**', 'node_modules/**'],
    environmentMatchGlobs: [
      ['src/__tests__/editor-integration.test.ts', 'jsdom'],
    ],
  },
})
