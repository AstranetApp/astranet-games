# The build stage acquires and verifies the same pinned official release used
# locally. The final image contains neither the archive nor extraction tools.

FROM node:24-alpine AS prepare
RUN apk add --no-cache tar xz
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
COPY scripts ./scripts
RUN npm ci --omit=dev --ignore-scripts
RUN npm run prepare && rm -rf /app/.cache

FROM node:24-alpine
WORKDIR /app
COPY --chown=node:node package.json ./
COPY --chown=node:node scripts/upstream.mjs ./scripts/upstream.mjs
COPY --chown=node:node server ./server
COPY --chown=node:node web ./web
COPY --chown=node:node --from=prepare /app/runtime/upstream ./runtime/upstream

RUN mkdir -p /data && chown node:node /data
ENV DATA_DIR=/data
ENV PORT=8098
ENV FRAME_ANCESTORS="'self'"
VOLUME /data
EXPOSE 8098

USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + process.env.PORT + '/healthz').then(r => { if (!r.ok) process.exit(1) }).catch(() => process.exit(1))"
CMD ["node", "server/server.js"]
