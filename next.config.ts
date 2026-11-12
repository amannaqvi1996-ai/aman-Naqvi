import type { NextConfig } from "next";

// Static export: the app is a client-side PWA talking directly to Supabase.
// All data access is protected by Row Level Security in the database.
const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  turbopack: {
    rules: {
      "*.css": { loaders: ["@tailwindcss/turbopack"], as: "*.css" },
    },
  },
};

export default nextConfig;
