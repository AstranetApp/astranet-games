import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Клиент собирается в client/dist — оттуда его раздаёт server/server.js.
// В dev-режиме API-запросы проксируются на локально поднятый сервер игры.
export default defineConfig({
  plugins: [react()],
  build: {
    target: 'es2022',
    assetsInlineLimit: 2048,
  },
  server: {
    port: 5197,
    proxy: {
      '/api': 'http://127.0.0.1:8097',
    },
  },
});
