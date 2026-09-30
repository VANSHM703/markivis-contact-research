# syntax=docker/dockerfile:1
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# Full source and dev dependencies: runs migrations and seeding (the compose "setup" service).
FROM node:24-alpine AS tools
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
CMD ["npx", "tsx", "scripts/setup.ts"]

FROM tools AS build
ARG APP_BASE_PATH=/intelligence
ENV APP_BASE_PATH=${APP_BASE_PATH}
RUN npm run build

# Web app image. The worker image is added in milestone M3 from the same base.
FROM node:24-alpine AS web
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
USER app
EXPOSE 3000
CMD ["node", "server.js"]
