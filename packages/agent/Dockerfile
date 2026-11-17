FROM node:24-bookworm

# git for the read-only clone and design branches; Python libraries for Word/Excel answers
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates ripgrep python3 python3-docx python3-openpyxl \
 && rm -rf /var/lib/apt/lists/* \
 && corepack enable

WORKDIR /opt/specforge
COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/agent ./packages/agent
RUN pnpm install --filter @specforge/agent --prod \
 && printf '#!/bin/sh\nexec node /opt/specforge/packages/agent/src/cli.ts "$@"\n' > /usr/local/bin/specforge \
 && chmod +x /usr/local/bin/specforge \
 && mkdir -p /work && chown node:node /work

USER node
ENV WORK_DIR=/work
CMD ["node", "/opt/specforge/packages/agent/src/runtime.ts"]
