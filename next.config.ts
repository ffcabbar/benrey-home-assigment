import { withPayload } from '@payloadcms/next/withPayload'
import type { NextConfig } from 'next'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(__filename)

const nextConfig: NextConfig = {
  // Stop `next dev` from writing an AI-assistant instructions file into the repo.
  agentRules: false,
  poweredByHeader: false,
  // No email provider, so no password reset pages.
  async redirects() {
    return [
      { source: '/admin/forgot', destination: '/admin/login', permanent: false },
      { source: '/admin/reset/:token*', destination: '/admin/login', permanent: false },
    ]
  },
  // No other site may frame the admin (clickjacking), browsers must not guess content types, and
  // full URLs are not leaked to other origins in the Referer header.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'self'" },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ]
  },
  // The dev-tools badge covers Payload's nav logout icon.
  devIndicators: false,
  webpack: (webpackConfig) => {
    webpackConfig.resolve.extensionAlias = {
      '.cjs': ['.cts', '.cjs'],
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
      '.mjs': ['.mts', '.mjs'],
    }

    return webpackConfig
  },
  turbopack: {
    root: path.resolve(dirname),
  },
}

export default withPayload(nextConfig, { devBundleServerPackages: false })
