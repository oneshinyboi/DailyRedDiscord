# syntax=docker/dockerfile:1

# ---- build: compile the server (tsc) and the client (vite) ----
FROM node:22-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY client/package.json client/
COPY server/package.json server/
RUN npm ci

COPY . .
# The Discord application id is public and baked into the client bundle.
ARG VITE_DISCORD_CLIENT_ID
ENV VITE_DISCORD_CLIENT_ID=$VITE_DISCORD_CLIENT_ID
RUN npm run build

# ---- runtime: server production dependencies + built output only ----
FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY client/package.json client/
COPY server/package.json server/
RUN npm ci --omit=dev -w server -w shared

COPY --from=build /app/server/dist server/dist
COPY --from=build /app/client/dist client/dist

# Battle sessions, streaks and stats live here; mount a volume to keep them.
ENV DB_PATH=/data/dailyred.sqlite \
    PORT=3001
RUN mkdir /data && chown node:node /data
VOLUME /data

USER node
WORKDIR /app/server
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://localhost:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

CMD ["node", "--disable-warning=ExperimentalWarning", "dist/server.js"]
