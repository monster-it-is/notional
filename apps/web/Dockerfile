FROM node:22-bookworm-slim AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY apps/web/tsconfig.json apps/web/tsconfig.json
COPY apps/web/tsconfig.app.json apps/web/tsconfig.app.json
COPY apps/web/tsconfig.node.json apps/web/tsconfig.node.json
COPY packages/contracts/tsconfig.json packages/contracts/tsconfig.json
RUN pnpm install --frozen-lockfile
COPY scripts/clean-dist.mjs scripts/clean-dist.mjs
COPY packages/contracts packages/contracts
COPY apps/web apps/web
ARG VITE_API_BASE_URL
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN test -n "$VITE_API_BASE_URL" || (echo "VITE_API_BASE_URL is required" && exit 1)
RUN pnpm --filter @notional/contracts build && pnpm --filter web build

FROM nginx:1.27-alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
