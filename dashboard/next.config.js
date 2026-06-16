/** @type {import('next').NextConfig} */
const BACKEND = process.env.BACKEND_URL || 'http://localhost:4000';

const nextConfig = {
  output: 'standalone',
  async rewrites() {
    // Proxy API + websocket to the backend during dev and in the container.
    return [
      { source: '/api/:path*', destination: `${BACKEND}/api/:path*` },
      { source: '/socket.io/:path*', destination: `${BACKEND}/socket.io/:path*` },
    ];
  },
};

module.exports = nextConfig;
