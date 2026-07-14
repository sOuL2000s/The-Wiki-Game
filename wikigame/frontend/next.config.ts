/** @type {import('next').NextConfig} */
const nextConfig = {
  /* config options here */
  // eslint: { // This configuration is no longer supported in Next.js 16.2.10+
  //   ignoreDuringBuilds: true,
  // },
  typescript: {
    ignoreBuildErrors: true,
  },
  // Add this to resolve the "Multiple lockfiles" warning
  experimental: {
    turbopack: {
      root: __dirname, // Explicitly set the frontend directory as the Turbopack root
    },
  },
};

export default nextConfig;
