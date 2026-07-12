# ──────────────────────────────────────────────────────────────────────────────
# Stage 1 — Install production dependencies
# ──────────────────────────────────────────────────────────────────────────────
FROM node:18-alpine AS deps

WORKDIR /app

COPY package.json package-lock.json ./

RUN npm ci --omit=dev

# ──────────────────────────────────────────────────────────────────────────────
# Stage 2 — Production image
# ──────────────────────────────────────────────────────────────────────────────
FROM node:18-alpine AS production

# Security: run as a non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

USER appuser

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:4000/health || exit 1

CMD ["node", "server.js"]
