import type { NextConfig } from "next";

const COLONY_API = process.env.COLONY_API_URL ?? "http://localhost:8080";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${COLONY_API}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
