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
  // Security headers on every response (BRD 18.3). The Content Security Policy is set per request
  // in src/proxy.ts, because it carries a nonce.
  async headers() {
    const https = (process.env.APP_URL ?? "").startsWith("https://");
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          ...(https ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }] : []),
        ],
      },
    ];
  },
};

export default nextConfig;
