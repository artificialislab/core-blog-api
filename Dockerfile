# ============================================================================
# Artificialis Lab — Blog API (imagem genérica)
#
# Provisionada automaticamente pelo platform backend no stack de qualquer
# cliente que subscribe "blog". Node 20 alpine, production only. Roda
# migrações idempotentes no startup antes do express subir.
# ============================================================================
FROM node:20-alpine

ARG BLOG_API_VERSION=dev

ENV NODE_ENV=production \
    BLOG_API_VERSION=$BLOG_API_VERSION

WORKDIR /app

# dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# source
COPY src ./src
COPY db ./db

# upload dir é um volume no compose — criamos pro dev local sem volume também
RUN mkdir -p /uploads

# Porta interna do container. Caddy do cliente faz reverse_proxy /api/* aqui.
EXPOSE 3001

# Healthcheck bate no próprio /health — fail marks unhealthy in `docker ps`
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3001) + '/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

# Migrations + server. Se migrate falhar, container não sobe.
CMD ["sh", "-c", "node src/migrate.js && node src/server.js"]
