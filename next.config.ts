import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // PGlite ships a WASM build of Postgres and happy-dom is only needed for
  // server-side HTML -> ProseMirror conversion; neither should be bundled.
  serverExternalPackages: ['@electric-sql/pglite', 'happy-dom', 'mammoth', 'pg'],
}

export default nextConfig
