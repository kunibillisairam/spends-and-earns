import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        admin: resolve(__dirname, 'admin.html'),
        auth: resolve(__dirname, 'auth.html'),
        analytics: resolve(__dirname, 'analytics.html'),
        settings: resolve(__dirname, 'settings.html'),
      },
    },
  },
});
