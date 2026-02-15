import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync, copyFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8'));

export default defineConfig(({ mode }) => {
  const isWebBuild = mode === 'web';

  return {
    plugins: [
      react(),
      {
        name: 'copy-changelog',
        writeBundle() {
          if (isWebBuild) {
            const src = resolve(__dirname, 'CHANGELOG.md');
            const dest = resolve(__dirname, 'dist-web', 'CHANGELOG.md');
            if (existsSync(src)) {
              copyFileSync(src, dest);
            }
          }
        },
      },
    ],
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
    },
    clearScreen: false,
    server: {
      port: 1422,
      strictPort: false,
      watch: {
        ignored: ['**/src-tauri/**'],
      },
    },
    build: {
      target: ['es2021', 'chrome100', 'safari13'],
      minify: !process.env.TAURI_DEBUG ? 'esbuild' : false,
      sourcemap: !!process.env.TAURI_DEBUG,
      ...(isWebBuild && { outDir: 'dist-web' }),
    },
  };
});
