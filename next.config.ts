import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR || ".next",
  output: "export", pageExtensions: ["tsx"], images: { unoptimized: true },
  cacheComponents: false,
  partialPrefetching: false,
  devIndicators: false,
  allowedDevOrigins: ["localhost", "127.0.0.1", "192.168.*.*", "10.*.*.*"],
  turbopack: {
    root: __dirname,  // ← جذر المشروع الحالي تلقائياً
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;