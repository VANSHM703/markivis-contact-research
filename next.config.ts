import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";

// The app is mounted behind a reverse proxy at APP_BASE_PATH (default /intelligence).
// Every route and asset URL is prefixed with it.
const basePath = process.env.APP_BASE_PATH ?? "/intelligence";

const nextConfig: NextConfig = {
  basePath,
  output: "standalone",
  poweredByHeader: false,
  // Pin the workspace root so a stray lockfile in a parent folder is never picked up.
  turbopack: { root: fileURLToPath(new URL(".", import.meta.url)) },
  env: {
    NEXT_PUBLIC_APP_BASE_PATH: basePath,
  },
};

export default nextConfig;
