import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import { defineConfig } from 'vite';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';

// https://vitejs.dev/config/
const devPort = 5175;
const katexVersion = process.env.npm_package_dependencies_katex?.replace(/^[~^]/, '') || '0.16.0';

const copyPhotonWasmPlugin = () => ({
  name: 'copy-photon-wasm',
  closeBundle() {
    const sourceCandidates = [
      path.resolve(__dirname, 'node_modules/@earendil-works/pi-coding-agent/node_modules/@silvia-odwyer/photon-node/photon_rs_bg.wasm'),
      path.resolve(__dirname, 'node_modules/@silvia-odwyer/photon-node/photon_rs_bg.wasm'),
    ];
    const source = sourceCandidates.find((candidate) => fs.existsSync(candidate));
    if (!source) {
      console.warn('[Vite] Photon WASM asset was not found; Electron main process may fail to start.');
      return;
    }
    const targetDir = path.resolve(__dirname, 'dist-electron');
    fs.mkdirSync(targetDir, { recursive: true });
    const target = path.join(targetDir, 'photon_rs_bg.wasm');
    if (fs.existsSync(target)) {
      const sourceBytes = fs.readFileSync(source);
      const targetBytes = fs.readFileSync(target);
      if (sourceBytes.equals(targetBytes)) return;
    }
    fs.copyFileSync(source, target);
  },
});

export default defineConfig({
  define: {
    // KaTeX ESM bundle references this compile-time constant.
    __VERSION__: JSON.stringify(katexVersion),
  },
  plugins: [
    react(),
    // CI build-renderer job 跳过 electron 构建（由 build-main job 单独负责）
    // 避免 renderer + main/preload 在同一进程内叠加 heap 导致 OOM
    ...(process.env.VITE_SKIP_ELECTRON ? [] : [electron([
      {
        // 主进程入口文件
        entry: 'src/main/main.ts',
        vite: {
          plugins: [copyPhotonWasmPlugin()],
          build: {
            sourcemap: true,
            outDir: 'dist-electron',
            minify: false,
            rollupOptions: {
              external: (id) => {
                const staticExternals = ['better-sqlite3', 'discord.js', 'zlib-sync', '@discordjs/opus', 'bufferutil', 'utf-8-validate'];
                if (staticExternals.includes(id)) return true;
                if (id.startsWith('@larksuite/openclaw-lark-tools') || id.startsWith('@larksuite/openclaw-lark')) return true;
                return false;
              },
              output: {
                // Keep CJS format (default), but load via ESM loader.mjs
                inlineDynamicImports: true,
              },
            },
          },
        },
        onstart() {
          // Signal that the main process bundle is ready for electron to load
          fs.writeFileSync('dist-electron/.electron-ready', '');
        },
      },
      {
        // 预加载脚本入口文件
        entry: 'src/main/preload.ts',
        vite: {
          build: {
            sourcemap: true,
            outDir: 'dist-electron',
            minify: false,
          },
        },
        onstart() {},
      },
    ])]),
    renderer(),
  ],
  base: process.env.NODE_ENV === 'development' ? '/' : './',
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, './src/shared'),
      '@': path.resolve(__dirname, './src/renderer'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    minify: false,
    // CI 中指定 chrome130（Electron 40 运行时）跳过降级转译省内存
    ...(process.env.CI && { target: 'chrome130' }),
  },
  server: {
    port: devPort,
    strictPort: true,
    host: true,
    hmr: {
      port: devPort,
    },
    watch: {
      usePolling: false,
    },
  },
  optimizeDeps: {
    exclude: ['electron', '@larksuite/openclaw-lark-tools', '@larksuite/openclaw-lark'],
    esbuildOptions: {
      define: {
        __VERSION__: JSON.stringify(katexVersion),
      },
    },
  },
  clearScreen: false,
});
