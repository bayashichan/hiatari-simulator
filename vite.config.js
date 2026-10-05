import { defineConfig } from 'vite';

export default defineConfig({
  // 相対パスで出力し、GitHub Pages などのサブディレクトリにもそのまま置けるようにする
  base: './',
  server: { port: 5173, open: false },
  // three.js を含むため 1 ファイルが大きくなるが、単一ページなので分割しない
  build: { chunkSizeWarningLimit: 1200 },
});
