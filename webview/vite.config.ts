import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        entryFileNames: 'index.js',
        assetFileNames: 'index.[ext]',
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    cors: {
      origin: /^vscode-webview:\/\//,
    },
    headers: {
      'Access-Control-Allow-Origin': '*',
    },
  },
})
