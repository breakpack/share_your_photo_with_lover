/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  experimental: {
    serverActions: { bodySizeLimit: '10gb' },
  },
};

module.exports = nextConfig;
