/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    // WARNING: disables linting at build time
    ignoreDuringBuilds: true,
  },
  typescript: {
    // WARNING: disables type checking at build time
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
