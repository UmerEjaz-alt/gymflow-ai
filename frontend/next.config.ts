import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // The media action enforces the existing 5 MB file limit. Multipart
    // boundaries need a small amount of additional request-body headroom.
    serverActions: { bodySizeLimit: "6mb" },
  },
};

export default nextConfig;
