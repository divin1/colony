import path from "path";
import type { NextConfig } from "next";

const COLONY_API = process.env.COLONY_API_URL ?? "http://localhost:8080";

const nextConfig: NextConfig = {
  output: "standalone",
  experimental: {
    // Trace deps from the monorepo root so hoisted node_modules are included
    // in the standalone output. __dirname is packages/web/ at build time.
    outputFileTracingRoot: path.join(__dirname, "../../"),
  },
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
