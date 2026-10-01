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

# Worker: queued jobs and the schedule (BRD 4.3). Runs the TypeScript source with tsx.
FROM tools AS worker
ENV NODE_ENV=production
RUN addgroup -S app && adduser -S app -G app && chown -R app:app /app
USER app
CMD ["npx", "tsx", "src/worker/index.ts"]

# Web app image.
FROM node:24-alpine AS web
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
# Mock mode reads fixtures at run time (demo mailbox, AI and source fixtures); the standalone
# output does not trace them because their paths are built at run time.
COPY --from=build --chown=app:app /app/fixtures ./fixtures
USER app
EXPOSE 3000
CMD ["node", "server.js"]
