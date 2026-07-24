/** @type {import('next').NextConfig} */
const BACKEND = process.env.BACKEND_URL || 'http://localhost:4000';

const nextConfig = {
  output: 'standalone',
  // `.eslintrc.json` exists for editor/`next lint` use, but the pre-existing
  // codebase has lint errors in files unrelated to any single feature; don't
  // let those fail `next build`'s production Docker image.
  eslint: { ignoreDuringBuilds: true },
  async rewrites() {
    // Proxy API + websocket to the backend during dev and in the container.
    return [
      { source: '/api/:path*', destination: `${BACKEND}/api/:path*` },
      { source: '/socket.io/:path*', destination: `${BACKEND}/socket.io/:path*` },
    ];
  },
};

module.exports = nextConfig;
