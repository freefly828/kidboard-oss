# syntax=docker/dockerfile:1
# KidBoard Renderer — 渲染 worker（Phase 3）
#
# 构建上下文为仓库根目录（compose 已配置 context: ..）。
#
# 关键点：
# 1. 基础镜像必须安装可再发行中文字体，否则 B03 会出 tofu/方框（docs/06 §3）；
# 2. Playwright 需要一组共享库；此处用 `playwright-core` + 显式系统依赖，
#    不安装 Playwright 官方镜像，以复用 pnpm workspace 与项目自身 tsconfig；
# 3. 浏览器只在镜像构建期下载一次（层缓存），运行期不联网。

FROM node:22-bookworm AS base
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN corepack enable
WORKDIR /app

# --- 系统依赖：中文字体 + Chromium 运行库（docs/06 §3 固定一套可再发行中文字体）---
FROM base AS sysdeps
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      fonts-noto-cjk \
      fonts-noto-cjk-extra \
      fontconfig \
      ca-certificates \
      # Chromium 运行期共享库（对应 playwright install-deps 的核心子集）
      libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
      libdbus-1-3 libatspi2.0-0 libxcomposite1 libxdamage1 libxfixes3 \
       libxrandr2 libgbm1 libxkbcommon0 libasound2 libpango-1.0-0 \
      libcairo2 libx11-6 libxcb1 libxext6 \
      tini \
 && fc-cache -f \
 && rm -rf /var/lib/apt/lists/*
# 字体可用性自检：容器内不存在 CJK 字体时构建直接失败（而不是运行时出 tofu）
RUN fc-list :lang=zh | head -5 \
 && fc-list :lang=zh | grep -qi "noto" || (echo "ERROR: no Noto CJK font installed" && exit 1)

# --- deps: 只拷贝清单，利用层缓存 ---
FROM sysdeps AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps/web/package.json apps/web/package.json
COPY apps/renderer/package.json apps/renderer/package.json
COPY apps/device-simulator/package.json apps/device-simulator/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/screen-template/package.json packages/screen-template/package.json
COPY packages/tsconfig/package.json packages/tsconfig/package.json
RUN pnpm install --frozen-lockfile

# --- 下载 Chromium（固定 revision，运行期离线）---
FROM deps AS browsers
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
# 必须用 renderer 锁定的 playwright-core（1.62.0）安装：根目录 npx 会临时拉取最新版，
# 下载的浏览器 revision 与运行期不匹配（Executable doesn't exist ... -1234）
RUN pnpm --filter @kidboard/renderer exec playwright-core install chromium \
 && CHROME_BIN="$(find /ms-playwright -name chrome -type f | head -1)" \
 && echo "chromium: $CHROME_BIN" \
 && "$CHROME_BIN" --version

# --- build: 编译 renderer（TS -> dist）---
# 注意：@kidboard/screen-template 以 TS 源码形式被引用（exports 指向 src/*.ts），
# 因此 build 阶段必须一并拷贝 packages，并在 TS 编译时可解析其 .tsx 入口。
FROM browsers AS build
COPY packages ./packages
COPY apps/renderer ./apps/renderer
# tsconfig.build.json 排除测试；packages/screen-template 的 tsx 由 jsx 选项处理
RUN pnpm --filter @kidboard/renderer exec tsc -p tsconfig.build.json

# --- runtime ---
FROM sysdeps AS runtime
ENV NODE_ENV=production
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV FRAMES_DIR=/data/frames
ENV RENDER_THRESHOLD=160
# 容器内 root 运行 Chromium 需要 --no-sandbox；生产若配置 USER 可去掉
ENV CHROMIUM_ARGS=--no-sandbox,--disable-dev-shm-usage,--disable-gpu
WORKDIR /app
RUN addgroup --system kidboard && adduser --system --ingroup kidboard kidboard

# 运行期只需要产物 + 依赖 + 浏览器；不拷贝 web 与源码
COPY --from=build --chown=kidboard:kidboard /app/node_modules ./node_modules
COPY --from=build --chown=kidboard:kidboard /app/packages ./packages
COPY --from=build --chown=kidboard:kidboard /app/apps/renderer/package.json ./apps/renderer/package.json
COPY --from=build --chown=kidboard:kidboard /app/apps/renderer/dist ./apps/renderer/dist
COPY --from=build --chown=kidboard:kidboard /app/apps/renderer/node_modules ./apps/renderer/node_modules
COPY --from=browsers --chown=kidboard:kidboard /ms-playwright /ms-playwright

RUN mkdir -p /data/frames && chown -R kidboard:kidboard /data/frames
VOLUME ["/data/frames"]

# 渲染是离线确定性任务：运行期必须能启动浏览器但不访问网络
USER kidboard
ENTRYPOINT ["/usr/bin/tini", "--"]
# @kidboard/* 以 TS 源码导出（含 .tsx 与无扩展名导入），Node 原生无法加载：经 tsx 加载器运行。
# 在 renderer 目录下启动，使 --import tsx 解析到 apps/renderer/node_modules/tsx。
WORKDIR /app/apps/renderer
CMD ["node", "--import", "tsx", "dist/main.js"]
