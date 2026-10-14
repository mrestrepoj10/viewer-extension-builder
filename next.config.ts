import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  cacheComponents: true,
  async redirects() {
    return [{ source: '/', destination: '/agent', permanent: false }]
  },
  partialPrefetching: true,
  turbopack: {
    rules: {
      '*.css': {
        loaders: ['@tailwindcss/turbopack'],
        as: '*.css',
      },
    },
  },
}

export default nextConfig
