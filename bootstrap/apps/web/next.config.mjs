/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@parasol/core', '@parasol/ai', '@parasol/corpus', '@parasol/playbooks'],
  experimental: {
    typedRoutes: true,
  },
};

export default nextConfig;
