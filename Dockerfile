# syntax=docker/dockerfile:1
# Build: compiles the React client and the TypeScript server.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig*.json vite.config.ts ./
COPY src ./src
RUN npm run build

# Runtime: production dependencies and the built output only, run as the unprivileged node user.
FROM node:22-slim
ENV NODE_ENV=production PORT=8080
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/dist ./dist
USER node
EXPOSE 8080
CMD ["node", "--disable-warning=ExperimentalWarning", "dist/server/server/index.js"]
