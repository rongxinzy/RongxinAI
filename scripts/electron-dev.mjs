import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import concurrently from 'concurrently';

import { resolveDevPort } from './find-dev-port.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..');
const localBinDirectory = path.join(projectRoot, 'node_modules', '.bin');

/**
 * Ensure local package binaries (vite / wait-on / electron) resolve on Windows
 * even when this script is not launched through npm/bun.
 * @param {NodeJS.ProcessEnv} env
 */
function withLocalBinPath(env) {
  const pathKey = Object.keys(env).find(key => key.toLowerCase() === 'path') || 'PATH';
  const current = env[pathKey] || '';
  if (current.split(path.delimiter).includes(localBinDirectory)) {
    return env;
  }
  return {
    ...env,
    [pathKey]: `${localBinDirectory}${path.delimiter}${current}`,
  };
}

async function main() {
  if (!fs.existsSync(localBinDirectory)) {
    throw new Error(`Missing ${localBinDirectory}; run npm/bun install first.`);
  }

  const port = await resolveDevPort();
  const startUrl = `http://localhost:${port}`;

  console.log(`[electron:dev] Using port ${port} (${startUrl})`);

  // Env is set on each command so Windows does not need cross-env for these vars.
  const sharedEnv = withLocalBinPath({
    ...process.env,
    VITE_SKIP_ELECTRON: '1',
    VITE_DEV_PORT: String(port),
    NODE_ENV: 'development',
    ELECTRON_START_URL: startUrl,
  });

  // Same startup contract as the original package.json script:
  // concurrently Vite + (wait-on assets → wait-on .electron-ready → electron)
  const { result } = concurrently(
    [
      {
        name: 'vite',
        command: `vite --port ${port}`,
        env: sharedEnv,
        cwd: projectRoot,
      },
      {
        name: 'electron',
        command: [
          `wait-on -l -t 120000 -i 1000 -s 1 http-get://localhost:${port}/src/renderer/main.tsx http-get://localhost:${port}/src/renderer/index.css`,
          'wait-on -l -t 120000 -i 1000 dist-electron/.electron-ready',
          'electron --remote-debugging-port=9222 .',
        ].join(' && '),
        env: sharedEnv,
        cwd: projectRoot,
      },
    ],
    {
      cwd: projectRoot,
      killOthers: ['failure', 'success'],
      killSignal: 'SIGKILL',
    },
  );

  try {
    await result;
    process.exit(0);
  } catch {
    process.exit(1);
  }
}

main().catch(error => {
  console.error('[electron:dev]', error instanceof Error ? error.message : error);
  process.exit(1);
});
