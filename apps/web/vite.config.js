import path from 'path';
import process from 'node:process';
import { fileURLToPath } from 'url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [react()],
    base: './',
    resolve: {
      alias: {
        '@shared': path.resolve(__dirname, '../../packages/shared/src'),
        '@': path.resolve(__dirname, '../../packages/shared/src'),
      },
    },
    build: {
      rollupOptions: {
        output: {
          entryFileNames: 'assets/[name].js',
          chunkFileNames: 'assets/[name].js',
          assetFileNames: 'assets/[name].[ext]',
        },
      },
    },
    server: {
      proxy: {
        '/api/csfloat': {
          target: 'https://csfloat.com/api/v1',
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/api\/csfloat/, ''),
          headers: {
            Authorization: env.CSFLOAT_API_KEY || '',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0',
            Accept: 'application/json',
          },
        },
      },
    },
  };
});
