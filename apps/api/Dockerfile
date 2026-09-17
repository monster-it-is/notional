FROM node:22-bookworm-slim AS base
RUN corepack enable
WORKDIR /app

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/trading/package.json packages/trading/package.json
COPY apps/api/tsconfig.json apps/api/tsconfig.json
COPY packages/db/tsconfig.json packages/db/tsconfig.json
COPY packages/contracts/tsconfig.json packages/contracts/tsconfig.json
COPY packages/trading/tsconfig.json packages/trading/tsconfig.json
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @notional/contracts --filter @notional/trading --filter @notional/db --filter api build
RUN pnpm --filter=api --prod --legacy deploy /out

FROM node:22-bookworm-slim AS runtime
RUN groupadd --system notional && useradd --system --gid notional --create-home notional
WORKDIR /app
COPY --from=build /out ./
COPY apps/api/docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh && chown -R notional:notional /app
USER notional
ENV NODE_ENV=production
EXPOSE 3000
ENTRYPOINT ["/app/docker-entrypoint.sh"]
