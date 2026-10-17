FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY app.js config.js server.js ./
USER node
EXPOSE 4000
# Node directly, not npm, so SIGTERM reaches the process.
CMD ["node", "server.js"]
