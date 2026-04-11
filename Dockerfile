FROM node:20-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app/server

COPY server/package*.json ./
RUN npm ci

COPY server/ ./
RUN npx prisma generate

ENV NODE_ENV=production \
    PORT=3005

EXPOSE 3005

CMD ["sh", "-c", "mkdir -p /data uploads uploads/covers audio && export DATABASE_URL=\"${DATABASE_URL:-file:/data/dev.db}\" && npx prisma db push --skip-generate && exec node --import tsx index.ts"]
