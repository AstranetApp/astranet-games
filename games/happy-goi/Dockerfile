# Сборка клиента (Vite + React) и запуск сервера без npm-зависимостей.

FROM node:24-alpine AS build
WORKDIR /app/client
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

FROM node:24-alpine
WORKDIR /app
COPY package.json ./
COPY server ./server
COPY --from=build /app/client/dist ./client/dist

# БД лежит на volume; каталог создаём заранее с правами node,
# чтобы named volume унаследовал владельца
RUN mkdir -p /data && chown node:node /data
ENV DATA_DIR=/data
ENV PORT=8097
VOLUME /data
EXPOSE 8097

USER node
CMD ["node", "server/server.js"]
