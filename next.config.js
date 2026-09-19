/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  serverRuntimeConfig: { projectDir: __dirname },
  // Scripts set EC12_DIST_DIR: dev uses .next, build/start use .next-build, so a
  // production build can never clobber a running dev server's .next.
  distDir: process.env.EC12_DIST_DIR || '.next',
  eslint: { ignoreDuringBuilds: true },
  experimental: { serverComponentsExternalPackages: ['playwright-core', 'pdf-parse', 'pdfjs-dist', 'mammoth'] },
};
module.exports = nextConfig;
