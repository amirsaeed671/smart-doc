import { defineConfig } from 'vitest/config'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      'server-only': path.resolve(__dirname, 'tests/server-only-stub.ts'),
    },
  },
  test: {
    environment: 'node',
    env: { PGLITE_DIR: 'memory://', SESSION_SECRET: 'test-secret-test-secret-test-secret' },
    testTimeout: 20000,
  },
})
