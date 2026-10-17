# api-sync-service. The same image also runs the migrations (docker-compose.yml,
# service "migrate"), so code and migrations always match.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY nest-cli.json tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY migrations ./migrations
USER node
EXPOSE 3000
# Node itself is the main process, not npm: npm does not reliably forward
# SIGTERM, and without it a running sync is killed instead of recorded as
# "aborted: shutdown" (spec 005, design).
CMD ["node", "dist/main.js"]
