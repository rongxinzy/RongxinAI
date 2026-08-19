import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import { defineConfig } from 'vite';
import electron from 'vite-plugin-electron';
import { extractExternalDeps } from 'vite-plugin-electron/plugin';
import renderer from 'vite-plugin-electron-renderer';

import { ELECTRON_MAIN_EXTERNALS } from './scripts/electron-runtime-dependencies.mjs';

// https://vitejs.dev/config/
const devPort = Number(process.env.VITE_DEV_PORT ?? 5175);
const katexVersion = process.env.npm_package_dependencies_katex?.replace(/^[~^]/, '') || '0.16.0';
const packageJson = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf8'),
) as Record<string, unknown>;
const electronDevelopmentExternalRoots = new Set(extractExternalDeps(packageJson, true));
const electronReadyPath = path.resolve(__dirname, 'dist-electron/.electron-ready');

function packageRoot(specifier: string): string {
  return specifier.startsWith('@')
    ? specifier.split('/').slice(0, 2).join('/')
    : specifier.split('/')[0];
}

function isElectronDevelopmentExternal(id: string): boolean {
  return electronDevelopmentExternalRoots.has(packageRoot(id));
}

const copyPhotonWasmPlugin = () => ({
  name: 'copy-photon-wasm',
  closeBundle() {
    const sourceCandidates = [
      path.resolve(
        __dirname,
        'node_modules/@earendil-works/pi-coding-agent/node_modules/@silvia-odwyer/photon-node/photon_rs_bg.wasm',
      ),
      path.resolve(__dirname, 'node_modules/@silvia-odwyer/photon-node/photon_rs_bg.wasm'),
    ];
    const source = sourceCandidates.find(candidate => fs.existsSync(candidate));
    if (!source) {
      console.warn(
        '[Vite] Photon WASM asset was not found; Electron main process may fail to start.',
      );
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

export default defineConfig(async ({ command }) => {
  const electronSourceMap = command === 'serve' || process.env.VITE_ELECTRON_SOURCEMAP === '1';
  if (!electronSourceMap) {
    for (const sourceMap of ['main.js.map', 'preload.js.map']) {
      fs.rmSync(path.resolve(__dirname, 'dist-electron', sourceMap), { force: true });
    }
  }

  return {
    define: {
      // KaTeX ESM bundle references this compile-time constant.
      __VERSION__: JSON.stringify(katexVersion),
    },
    plugins: [
      (await import('@tailwindcss/vite')).default(),
      react(),
      // CI build-renderer job 跳过 electron 构建（由 build-main job 单独负责）
      // 避免 renderer + main/preload 在同一进程内叠加 heap 导致 OOM
      ...(process.env.VITE_SKIP_ELECTRON
        ? []
        : [
            electron([
              {
                // 主进程入口文件
                entry: 'src/main/main.ts',
                vite: {
                  plugins: [copyPhotonWasmPlugin()],
                  build: {
                    sourcemap: electronSourceMap,
                    outDir: 'dist-electron',
                    minify: false,
                    rollupOptions: {
                      external:
                        command === 'serve'
                          ? isElectronDevelopmentExternal
                          : id => ELECTRON_MAIN_EXTERNALS.includes(id),
                      output: {
                        // Keep CJS format (default), but load via ESM loader.mjs
                        inlineDynamicImports: true,
                      },
                    },
                  },
                },
                onstart() {
                  // Signal that the main process bundle is ready for electron to load
                  fs.writeFileSync(electronReadyPath, '');

                  // Copy photon-node WASM artifact into dist-electron so pi-coding-agent can load it
                  const wasmSource = path.resolve(
                    __dirname,
                    'node_modules/@earendil-works/pi-coding-agent/node_modules/@silvia-odwyer/photon-node/photon_rs_bg.wasm',
                  );
                  const wasmDest = path.resolve(__dirname, 'dist-electron/photon_rs_bg.wasm');
                  if (fs.existsSync(wasmSource) && !fs.existsSync(wasmDest)) {
                    fs.copyFileSync(wasmSource, wasmDest);
                  }
                },
              },
              {
                // 预加载脚本入口文件
                entry: 'src/main/preload.ts',
                vite: {
                  build: {
                    sourcemap: electronSourceMap,
                    outDir: 'dist-electron',
                    minify: false,
                  },
                },
                onstart() {},
              },
            ]),
          ]),
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
      // Production packages ship minified JS without sourcemaps to keep the
      // initial bundle small. Set VITE_RENDERER_SOURCEMAP=1 to emit maps for
      // diagnostics builds only.
      sourcemap: process.env.VITE_RENDERER_SOURCEMAP === '1',
      minify: 'esbuild',
      rollupOptions: {
        input: {
          main: path.resolve(__dirname, 'index.html'),
          officePreview: path.resolve(__dirname, 'office-preview.html'),
        },
      },
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
      exclude: ['electron'],
      esbuildOptions: {
        define: {
          __VERSION__: JSON.stringify(katexVersion),
        },
      },
    },
    clearScreen: false,
  };
});
