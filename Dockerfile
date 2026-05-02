# syntax=docker/dockerfile:1.7

# -----------------------------------------------------------------------------
# Build stage — TypeScript → dist/
# -----------------------------------------------------------------------------
FROM node:20-alpine AS build

WORKDIR /app

# Native deps required by chrome-cookies-secure -> sqlite3 (build only)
RUN apk add --no-cache python3 make g++ pkgconfig

COPY package.json package-lock.json ./
RUN npm ci --include=dev

COPY tsconfig.json tsup.config.ts ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# -----------------------------------------------------------------------------
# Runtime stage — minimal node + bundled server
# -----------------------------------------------------------------------------
FROM node:20-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production \
    INFOMANIAK_AUTH_MODE=disabled \
    LOG_LEVEL=info

# Copy production node_modules + bundled output from build stage
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./

# MCP servers communicate over stdio. No port to expose.
# The container is meant to be exec'd by an MCP client (e.g. Claude Desktop)
# or by Glama's introspection runner.
ENTRYPOINT ["node", "/app/dist/server.js"]
