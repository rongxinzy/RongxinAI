import fs from 'node:fs';
import path from 'node:path';

const { access, readFile, readdir, stat } = fs.promises;

function exists(file: string): Promise<boolean> {
  return access(file).then(
    () => true,
    () => false,
  );
}

export async function inspectWebSearchRuntime(
  root: string,
  { development = false, signal }: { development?: boolean; signal?: AbortSignal } = {},
): Promise<{ ready: boolean; needsBuild: boolean }> {
  const serverDirectory = path.join(root, 'server');
  const compiledDirectory = path.join(root, 'dist', 'server');
  const serverEntry = path.join(compiledDirectory, 'index.js');
  const read = (file: string) => readFile(file, { encoding: 'utf8', signal }).catch(() => '');
  const [launcher, search, compiled, sourceControl, compiledControl, iconv] = await Promise.all([
    read(path.join(root, 'scripts', 'start-server.mjs')),
    read(path.join(root, 'scripts', 'search.mjs')),
    read(serverEntry),
    exists(path.join(serverDirectory, 'standaloneControl.cjs')),
    exists(path.join(compiledDirectory, 'standaloneControl.cjs')),
    exists(path.join(root, 'node_modules', 'iconv-lite', 'encodings', 'index.js')),
  ]);
  signal?.throwIfAborted();

  const needsBuild =
    !compiledControl ||
    !compiled.includes('runBridgeProcess') ||
    !compiled.includes('decodeJsonRequestBody') ||
    !compiled.includes("TextDecoder('gb18030'") ||
    (compiled.includes('scoreDecodedJsonText') &&
      compiled.includes('Request body decoded using gb18030 (score')) ||
    (development && (await hasNewerSource(serverDirectory, serverEntry, signal)));
  const ready =
    !needsBuild &&
    sourceControl &&
    iconv &&
    ['WEB_SEARCH_FORCE_REPAIR', 'detectHealthyBridgeServer', 'stopStandaloneBridge'].every(text =>
      launcher.includes(text),
    ) &&
    ['ACTIVE_SERVER_URL', 'trySwitchToLocalServer', 'buildSearchPayload', '@query_file'].every(
      text => search.includes(text),
    );
  return { ready, needsBuild };
}

async function hasNewerSource(
  root: string,
  output: string,
  signal?: AbortSignal,
): Promise<boolean> {
  try {
    const compiledTime = (await stat(output)).mtimeMs;
    const directories = [root];
    for (const directory of directories) {
      signal?.throwIfAborted();
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) directories.push(file);
        else if (
          entry.isFile() &&
          /\.(ts|cjs)$/.test(entry.name) &&
          (await stat(file)).mtimeMs > compiledTime
        ) {
          return true;
        }
      }
    }
    return false;
  } catch {
    signal?.throwIfAborted();
    return true;
  }
}
