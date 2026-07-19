# Production image for the Elebhar FMS API (used by Railway).
# Debian/glibc on purpose (keeps the linux-x64-gnu native binaries the pnpm
# overrides rely on). Builds the Express API to a single esbuild bundle; the
# bundle externalizes some deps, so node_modules is kept for runtime.
FROM node:24-bookworm-slim

RUN corepack enable && corepack prepare pnpm@11.0.9 --activate

WORKDIR /app
COPY . .

# Install everything (build needs dev deps). pnpm 11 errors on "ignored" build
# scripts, so install with --ignore-scripts then rebuild the native deps that
# genuinely need their scripts (esbuild, @swc/core, msw, unrs-resolver).
RUN pnpm install --frozen-lockfile --ignore-scripts \
  && pnpm rebuild -r

# Build the API: esbuild bundle -> artifacts/api-server/dist/index.cjs
RUN pnpm --filter @workspace/api-server run build

ENV NODE_ENV=production
# Railway provides PORT at runtime.
CMD ["node", "artifacts/api-server/dist/index.cjs"]
