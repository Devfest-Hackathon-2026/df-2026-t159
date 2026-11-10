import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Cloud Run へ単一アプリとしてデプロイする前提（Issue 1）
  output: "standalone",
};

export default nextConfig;
