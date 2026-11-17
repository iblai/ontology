# ============================================================
# Dockerfile — the whole console, for a client's server
#
# Next's standalone build: the pages, /api/host/* and the MCP gateway; deploy/compose.yaml
# runs it beside NVIDIA's engine. amd64 only: Toolbox ships one glibc x64 binary.
#
#   docker build --platform linux/amd64 -t public.ecr.aws/ibleducation/iblai-ontology:dev .
# ============================================================
FROM node:24-slim AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /src

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
ENV NEXT_OUTPUT=standalone NEXT_TELEMETRY_DISABLED=1
# The ibl.ai addresses the pages call, which Next fixes at build. Left out: the hosted platform's.
ARG NEXT_PUBLIC_API_BASE_URL
ARG NEXT_PUBLIC_AUTH_URL
ARG NEXT_PUBLIC_BASE_WS_URL
ARG NEXT_PUBLIC_PLATFORM_BASE_DOMAIN
ARG NEXT_PUBLIC_LEGACY_LMS_URL
ARG NEXT_PUBLIC_MFE_URL
RUN pnpm build

# File tracing leaves the binary out; cp fails the build when the pattern matches nothing.
RUN cp node_modules/.pnpm/@toolbox-sdk+server-linux-x64@*/node_modules/@toolbox-sdk/server-linux-x64/bin/toolbox /toolbox

FROM node:24-slim

# The repository the image is built from.
LABEL org.opencontainers.image.source="https://github.com/iblai/ontology"

# Toolbox is a Go binary and reads the system's CA store.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=build /src/.next/standalone ./
COPY --from=build /src/.next/static ./.next/static
COPY --from=build /src/public ./public
COPY --from=build /toolbox /usr/local/bin/toolbox

# Loopback only: Caddy is the one way in.
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=127.0.0.1 PORT=3000 \
    ONTOLOGY_HOME=/data TOOLBOX_BIN=/usr/local/bin/toolbox

# A new volume on /data takes this owner.
RUN mkdir /data && chown node:node /data
USER node

CMD ["node", "server.js"]
