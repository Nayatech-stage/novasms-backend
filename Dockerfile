FROM node:22-bookworm-slim AS deps

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --no-audit --no-fund \
  --fetch-retries=5 \
  --fetch-retry-mintimeout=20000 \
  --fetch-retry-maxtimeout=120000

COPY prisma ./prisma
RUN DATABASE_URL="postgresql://novasms:novasms@localhost:5432/novasms?schema=public" npx prisma generate

RUN npm prune --omit=dev --no-audit --no-fund

FROM node:22-bookworm-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates dumb-init openssl \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 nestjs

COPY --from=deps --chown=nestjs:nodejs /app/package*.json ./
COPY --from=deps --chown=nestjs:nodejs /app/node_modules ./node_modules
COPY --from=deps --chown=nestjs:nodejs /app/prisma ./prisma
COPY --chown=nestjs:nodejs dist ./dist

RUN mkdir -p /app/uploads \
  && chown -R nestjs:nodejs /app/uploads

USER nestjs

EXPOSE 3000

CMD ["dumb-init", "npm", "run", "start:docker"]
