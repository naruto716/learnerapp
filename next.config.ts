import type { NextConfig } from "next";

// Desktop packaging uses a static export; development can still use the normal Next server.
const nextConfig: NextConfig = {
  ...(process.env.NEXT_OUTPUT_EXPORT === "1" ? { output: "export" as const } : {}),
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
