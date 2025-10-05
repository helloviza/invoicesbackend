# apps/backend/Dockerfile

########################
# 1) Build stage
########################
FROM node:20-alpine AS build
WORKDIR /app
ENV NODE_ENV=development

# system bits some libs want
RUN apk add --no-cache libc6-compat

# Install deps (dev deps included for build)
COPY package.json package-lock.json* ./
# If you don't have a package-lock.json, this falls back to npm i
RUN if [ -f package-lock.json ]; then npm ci; else npm i; fi

# Prisma client generation needs the schema
COPY prisma ./prisma
RUN npx prisma generate

# Copy TS sources and build
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

########################
# 2) Runtime stage
########################
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080

# Only production deps for a slim image
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm i --omit=dev; fi

# Copy prisma engine/client built in the builder
COPY --from=build /app/node_modules/.prisma /app/node_modules/.prisma

# Copy compiled JS
COPY --from=build /app/dist ./dist

# (Optional) if your code loads branding files at runtime, copy them too:
# COPY src/assets ./assets

EXPOSE 8080
CMD ["node", "dist/server.js"]
