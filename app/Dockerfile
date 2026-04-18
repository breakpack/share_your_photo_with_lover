# syntax=docker/dockerfile:1.6

FROM node:20-alpine AS deps
WORKDIR /app
# Prisma needs openssl to pick the right query engine binary; libc6-compat is
# required by sharp's prebuilt binaries on alpine.
RUN apk add --no-cache openssl libc6-compat
COPY package.json ./
RUN npm install --no-audit --no-fund --loglevel=error

FROM node:20-alpine AS builder
WORKDIR /app
RUN apk add --no-cache openssl libc6-compat
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json next.config.js next-env.d.ts postcss.config.js tailwind.config.ts ./
COPY prisma ./prisma
COPY src ./src
ENV NEXT_TELEMETRY_DISABLED=1
RUN npx prisma generate
RUN npm run build
RUN npm prune --omit=dev

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# sharp ships pre-built binaries that need libc6-compat on alpine
RUN apk add --no-cache libc6-compat openssl

# Next.js standalone build: copies only what is needed to run
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
# Prisma schema + generated client + node_modules needed for migrations at start
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

# Entrypoint: run migrations then start the server
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 3000
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server.js"]
