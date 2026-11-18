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
