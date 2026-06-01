# ── Stage 1: Builder ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Install deps first (better layer caching — only re-runs when package.json changes)
COPY package*.json ./
COPY prisma ./prisma/
RUN npm ci

# Generate Prisma client for the build environment
RUN npx prisma generate

# Compile TypeScript
COPY tsconfig.json ./
COPY src ./src/
RUN npm run build

# ── Stage 2: Production ───────────────────────────────────────────────────────
FROM node:20-alpine

# dumb-init: proper PID 1 signal handling (SIGTERM → graceful shutdown)
RUN apk add --no-cache dumb-init

WORKDIR /app

# Install production dependencies only
COPY package*.json ./
COPY prisma ./prisma/
RUN npm ci --omit=dev

# Generate Prisma client for Alpine (platform-specific binary)
RUN npx prisma generate

# Copy compiled output from builder
COPY --from=builder /app/dist ./dist

# Startup script
COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["dumb-init", "--"]
CMD ["./entrypoint.sh"]
