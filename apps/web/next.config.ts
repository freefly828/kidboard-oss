import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Phase 0 基线配置。
  // - standalone: 供 infra/web.Dockerfile 产出最小运行时镜像。
  // - transpilePackages: workspace 内 TS 源码包（@kidboard/db）需要被 Next 编译。
  output: "standalone",
  transpilePackages: ["@kidboard/db", "@kidboard/screen-template"],
  reactStrictMode: true,
};

export default nextConfig;
