FROM node:20-alpine AS build

WORKDIR /workspace/apps/web
COPY apps/web/package.json apps/web/package-lock.json ./
RUN npm ci
COPY apps/web ./
RUN npm run build

FROM node:20-alpine AS runner

WORKDIR /workspace/apps/web
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
COPY --from=build --chown=node:node /workspace/apps/web/.next/standalone/apps/web ./
USER node
EXPOSE 3000
CMD ["node", "server.js"]
