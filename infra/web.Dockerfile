# syntax=docker/dockerfile:1
# KidBoard Web — Next.js standalone 构建（Phase 0 基线）
# 构建上下文为仓库根目录（compose 已配置 context: ..）。

FROM node:22-alpine AS base
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app

# --- deps: 只拷贝清单，利用层缓存 ---
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc* ./
COPY apps/web/package.json apps/web/package.json
COPY apps/renderer/package.json apps/renderer/package.json
COPY apps/device-simulator/package.json apps/device-simulator/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/screen-template/package.json packages/screen-template/package.json
COPY packages/tsconfig/package.json packages/tsconfig/package.json
RUN pnpm install --no-frozen-lockfile

# --- build ---
FROM base AS build
# 整体拷贝（保留 pnpm workspace 符号链接结构，避免逐目录拷贝丢失 .pnpm 软链）
COPY --from=deps /app ./
COPY apps/web ./apps/web
COPY apps/renderer ./apps/renderer
COPY apps/device-simulator ./apps/device-simulator
COPY packages ./packages
COPY pnpm-workspace.yaml package.json ./
ENV NEXT_TELEMETRY_DISABLED=1
# DATABASE_URL 仅在运行时使用; build 阶段页面为 force-dynamic, 不做数据抓取
RUN pnpm --filter @kidboard/web build

# --- runtime ---
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
RUN addgroup -S kidboard && adduser -S kidboard -G kidboard
COPY --from=build --chown=kidboard:kidboard /app/apps/web/.next/standalone ./
COPY --from=build --chown=kidboard:kidboard /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=kidboard:kidboard /app/apps/web/public ./apps/web/public
USER kidboard
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
