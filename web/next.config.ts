import path from 'node:path';
import type { NextConfig } from 'next';

const API_ORIGIN = process.env.API_ORIGIN ?? 'http://localhost:3000';

const nextConfig: NextConfig = {
  output: 'standalone',
  // The repo root also has a bun.lock, so Turbopack would otherwise infer the
  // parent directory as the workspace root and warn on every start.
  turbopack: { root: path.resolve(import.meta.dirname) },
  async rewrites() {
    // Everything backend is namespaced under /api so it can never collide with
    // page routes like /drafts or /runs.
    return [{ source: '/api/:path*', destination: `${API_ORIGIN}/:path*` }];
  },
};

export default nextConfig;
