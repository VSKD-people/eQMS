import type { NextConfig } from 'next';

// Standalone output gives a small Node server for the container image (see infra and the Dockerfile).
// @veqms/domain is TypeScript source in the workspace, so Next compiles it.
const config: NextConfig = {
  output: 'standalone',
  transpilePackages: ['@veqms/domain'],
  poweredByHeader: false,
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'same-origin' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' }
      ]
    }];
  }
};

export default config;
