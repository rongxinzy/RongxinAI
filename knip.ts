import type { KnipConfig } from 'knip';

/** Tailwind and shadcn are imported from CSS, which Knip does not parse by default. */
function compileCss(source: string): string {
  const specifiers = new Set<string>();
  for (const match of source.matchAll(/@(?:import|plugin)\s+['"]([^'"]+)['"]/g)) {
    specifiers.add(match[1]);
  }
  return [...specifiers].map(specifier => `import '${specifier}';`).join('\n');
}

const config: KnipConfig = {
  compilers: {
    css: compileCss,
  },
  workspaces: {
    '.': {
      entry: [
        // vite-plugin-electron bundle entries. Knip's Vite plugin reads HTML and
        // rolldown inputs, not the electron() entry list in vite.config.ts.
        'src/main/main.ts',
        'src/main/preload.ts',
        'src/main/llamacppModelDaemonEntry.ts',
        'src/main/workbenchTask/artifactWorker.ts',
        'src/main/magpie/catalogWorker.ts',
        'src/main/magpie/hashWorker.ts',
        'src/main/libs/appUpdateHashWorker.ts',
        'src/main/pythonRuntime/runner.ts',
        // Spawned by path.join(__dirname, '...js'), not a static import.
        'src/main/extensions/aisphere/requestWorker.ts',
        'scripts/installer-shell/build-shell.cjs',
        'scripts/installer-shell/pack-setup.cjs',
        'scripts/installer-shell/make-test-payload.cjs',
        'scripts/patch-windows-electron-icon.mjs',
        'scripts/write-windows-dev-shortcut.cjs',
        'scripts/prepare-visual-blind-review.mjs',
        'scripts/ci/validate-docx-smoke.mjs',
        // Manual installer and preview harnesses. Workflows do not call them.
        'scripts/installer-shell/assert-e2e.cjs',
        'scripts/installer-shell/e2e-sfx.cjs',
        'scripts/installer-shell/e2e-uninstall.cjs',
        'scripts/installer-ui/build-preview.cjs',
        // Renderer workers constructed with `new Worker(new URL(..., import.meta.url))`.
        'src/renderer/components/artifacts/renderers/csvPreview.worker.ts',
        'src/renderer/components/artifacts/renderers/dxfPreview.worker.ts',
        'src/renderer/services/artifactDetection.worker.ts',
        // electron-builder hook paths. The packaging config is not a Knip plugin input.
        'scripts/electron-builder-hooks.cjs',
        'scripts/notarize.js',
        'scripts/sign-magpie-macos.cjs',
        'electron-builder.enterprise.cjs',
        'electron-builder.windows-signed.cjs',
        'electron-builder.xiaoruan.cjs',
      ],
      project: [
        'src/**/*.{js,mjs,cjs,jsx,ts,tsx,css}',
        'scripts/**/*.{js,mjs,cjs,jsx,ts,tsx}',
        'tests/**/*.{js,mjs,cjs,jsx,ts,tsx}',
        'electron-builder*.cjs',
      ],
    },
    enterprise: {
      // Separate tsconfig: `@/*` maps to enterprise/src/ui, not the renderer.
      // Vite's `--config` is chained after `&&` in build:enterprise, so the
      // script parser does not load this UI bundle on its own.
      entry: ['src/extension.ts', 'src/ui/main.tsx', 'vite.ui.config.ts'],
      project: ['src/**/*.{ts,tsx,d.ts,css}', 'scripts/**/*.{js,mjs,cjs,d.ts}'],
    },
  },
  vitest: {
    entry: [
      'src/**/*.{test,spec}.{ts,tsx}',
      'tests/**/*.{test,spec}.{ts,tsx,mjs}',
      'scripts/**/*.{test,spec}.{ts,tsx,mjs,cjs}',
      'src/**/__mocks__/**/*.{ts,tsx}',
      'tests/**/__mocks__/**/*.{ts,tsx}',
      'enterprise/**/*.{test,spec}.{ts,tsx,mjs}',
    ],
  },
  ignoreBinaries: [
    // Operating-system commands, not npm packages.
    'openssl',
    'reg',
    'taskkill.exe',
    'wscript.exe',
    // Binary shipped by electron-builder's @electron/rebuild.
    'electron-rebuild',
  ],
  ignoreDependencies: [
    // Production packages installed for the packaged app, not static imports.
    // scripts/electron-runtime-dependencies.mjs is the allowlist.
    '@agentclientprotocol/claude-agent-acp',
    '@agentclientprotocol/codex-acp',
    'ajv',
    'ajv-formats',
    'bufferutil',
    'npm',
    'utf-8-validate',
    // Spawned from scripts/electron-dev.mjs as a CLI string.
    'wait-on',
    // esbuild stdin in scripts/build-skill-tech-news.js: require("rss-parser").
    'rss-parser',
    // Loaded through `new Function('specifier', 'return import(specifier)')`.
    '@nodesecure/js-x-ray',
    // Direct imports of packages that electron-builder and Pi already install.
    '@electron/asar',
    '@electron/notarize',
    '@electron/osx-sign',
    'app-builder-lib',
    'dotenv',
    'typebox',
    '@earendil-works/pi-agent-core',
    '@earendil-works/chord',
    '@earendil-works/pi-durable',
  ],
  // llama.cpp sources stay untouched. Suppress findings instead of editing them.
  // Root-level only: workspace ignoreIssues are not applied to ".".
  ignoreIssues: {
    'src/main/llamacppModelDaemonEntry.ts': ['exports', 'types', 'files'],
    'src/main/libs/llamacpp*.ts': ['exports', 'types', 'files'],
    'src/main/ipcHandlers/llamacpp.ts': ['exports', 'types', 'files'],
    'src/shared/llamacpp/**': ['exports', 'types', 'files'],
    'src/renderer/utils/llamacppAgentEligibility.ts': ['exports', 'types', 'files'],
    'scripts/**/*llamacpp*': ['exports', 'types', 'files'],
  },
  // @knipignore marks a dynamic import() type query Knip cannot see.
  tags: ['-knipignore'],
  ignoreUnresolved: [
    // Opt-in Magpie smoke imports a durable provider the gateway refactor owns.
    // The module is not in this tree; the test stays skipped without the env flag.
    '../libs/agentEngine/durable/provider',
  ],
  // Intentional aliases (parseX = createX, marketplace counts sharing one value).
  exclude: ['duplicates'],
};

export default config;
