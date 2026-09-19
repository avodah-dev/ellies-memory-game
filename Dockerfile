# syntax=docker/dockerfile:1
FROM oven/bun:1.3.9 AS bun-toolchain
FROM node:24.7.0-bookworm-slim AS dependencies
COPY --from=bun-toolchain /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM dependencies AS build
ARG BUILD_COMMIT_SHA
ENV BUILD_COMMIT_SHA=$BUILD_COMMIT_SHA
COPY . .
RUN test -n "$BUILD_COMMIT_SHA" && bun run build:production

FROM oven/bun:1.3.9 AS production-dependencies
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM oven/bun:1.3.9-slim AS runtime
WORKDIR /app
ARG BUILD_COMMIT_SHA
ENV NODE_ENV=production APP_COMMIT=$BUILD_COMMIT_SHA
COPY --from=production-dependencies --chown=bun:bun /app/node_modules ./node_modules
COPY --from=build --chown=bun:bun /app/dist ./dist
COPY --chown=bun:bun server ./server
COPY --chown=bun:bun shared ./shared
COPY --chown=bun:bun package.json ./
USER bun
EXPOSE 5457
CMD ["bun", "server/index.ts"]
