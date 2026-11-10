# syntax=docker/dockerfile:1
# Imagen de la API. Contexto de construcción = raíz del repositorio:  docker build -t centro-actoral-api .

# ---------- base: Node + OpenSSL (Prisma) ----------
FROM node:20-slim AS base
RUN apt-get update -y \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# ---------- build: dependencias completas, cliente Prisma y compilación ----------
FROM base AS build
COPY api/package*.json ./
COPY api/prisma ./prisma
# npm ci si existe package-lock.json (builds reproducibles); si no, npm install
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi
COPY api/ ./
RUN npx prisma generate && npm run build

# ---------- prod-deps: solo dependencias de producción ----------
FROM base AS prod-deps
COPY api/package*.json ./
COPY api/prisma ./prisma
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi \
 && npm cache clean --force

# ---------- runtime: imagen final mínima, usuario sin privilegios ----------
FROM base AS runtime
ENV NODE_ENV=production PORT=3000
COPY --from=prod-deps /app/node_modules ./node_modules
# cliente Prisma ya generado (el CLI no viaja a producción)
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY api/package.json ./
COPY api/assets ./assets
# Sitio web (frontend + rutas /api/*) y sus archivos estáticos
COPY api/web ./web
COPY public ./public
COPY db/migrations ./db/migrations
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# RUN_MIGRATIONS=true aplica las migraciones pendientes antes de arrancar (seguro con varias réplicas: usa lock)
CMD ["sh", "-c", "if [ \"$RUN_MIGRATIONS\" = \"true\" ]; then node dist/db/migrate.js || exit 1; fi; exec node dist/main.js"]
