# syntax=docker/dockerfile:1

# ---- builder: install everything, generate Prisma client, compile TS ----
FROM node:22.23.4-alpine AS builder
WORKDIR /app

# Prisma's query engine needs openssl on Alpine (musl).
RUN apk add --no-cache --upgrade openssl ca-certificates && update-ca-certificates

COPY package*.json ./
RUN npm ci

COPY prisma ./prisma
COPY openapi ./openapi
COPY tsconfig.json ./
COPY src ./src

# `build` runs `prisma generate && tsc && copy openapi.yaml into dist/`.
RUN npm run build

# ---- runtime: prod deps only + compiled output ----
FROM node:22.23.4-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN apk add --no-cache --upgrade openssl ca-certificates && update-ca-certificates

COPY package*.json ./
RUN npm ci --omit=dev

# Bring over the generated Prisma client engine (built in the builder stage)
# and the compiled app. Migrations ship so `prisma migrate deploy` can run.
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/dist ./dist
COPY prisma ./prisma

EXPOSE 3001
CMD ["node", "dist/index.js"]
