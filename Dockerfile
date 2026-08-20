# syntax=docker/dockerfile:1

# ---- Stage 1: build ----
FROM node:22-slim AS build
WORKDIR /app

# Toolchain nativa necessária para compilar o bcrypt (node-gyp)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

# --legacy-peer-deps: o lockfile atual tem um conflito de peer deps pré-existente
# (@golevelup/nestjs-rabbitmq pede NestJS 11, o projeto está em NestJS 9) — já é
# assim fora do Docker, não é algo introduzido por este build.
COPY package*.json ./
RUN npm ci --legacy-peer-deps

COPY tsconfig*.json ./
COPY src ./src
RUN npm run build

# ---- Stage 2: runtime ----
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Chromium do Debian (apt já resolve as libs de sistema — libnss3, libatk, libgtk etc —
# que node:22-slim não tem; o download interno do Puppeteer falha silenciosamente sem
# elas). PUPPETEER_SKIP_DOWNLOAD evita baixar de novo via npm; FiscalDanfeService (DANFE
# em PDF) aponta pro binário via PUPPETEER_EXECUTABLE_PATH.
RUN apt-get update && apt-get install -y --no-install-recommends chromium \
    && rm -rf /var/lib/apt/lists/*
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

COPY package*.json ./
RUN npm ci --omit=dev --legacy-peer-deps && npm cache clean --force

COPY --from=build /app/dist ./dist

RUN groupadd --system app && useradd --system --gid app app \
    && chown -R app:app /app
USER app

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/health/ping', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "dist/main.js"]
