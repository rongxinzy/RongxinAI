import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import {
  createServer,
  request,
  type IncomingMessage,
  type RequestOptions,
  type Server,
} from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { buildBlockMap } from 'app-builder-lib/out/targets/blockmap/blockmap';
import { NsisUpdater } from 'electron-updater/out/NsisUpdater';
import { ElectronHttpExecutor } from 'electron-updater/out/electronHttpExecutor';
import { afterEach, expect, test, vi } from 'vitest';
import { electronUpdaterFeedOptions } from '../../src/main/libs/appUpdateChannelPreference';
import { AppUpdateReleaseChannel } from '../../src/main/libs/appUpdateManifest';

const RangeResponse = {
  Partial: 'partial',
  Whole: 'whole',
  Corrupt: 'corrupt',
  Disconnect: 'disconnect',
} as const;
type RangeResponse = (typeof RangeResponse)[keyof typeof RangeResponse];
const fixtures: Array<{ root: string; server: Server }> = [];

afterEach(async () => {
  for (const { root, server } of fixtures.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close(error => (error ? reject(error) : resolve())),
    );
    await fs.rm(root, { recursive: true, force: true });
  }
});

async function fixture(
  options: {
    seedInstaller?: boolean;
    oldBlockmap?: boolean;
    rangeResponse?: RangeResponse;
    corruptFull?: boolean;
    oldBytes?: Buffer;
    oldVersion?: string;
    version?: string;
  } = {},
) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-update-'));
  const oldVersion = options.oldVersion ?? '2026.11.24-build.2';
  const version = options.version ?? '2026.11.24-build.3';
  const filename = (v: string) => `ZhiYuan-Setup-${v}.exe`;
  const oldBytes = options.oldBytes ?? randomBytes(1024 * 1024);
  const newBytes = Buffer.from(oldBytes);
  randomBytes(4096).copy(newBytes, 128 * 1024);
  randomBytes(4096).copy(newBytes, 768 * 1024);
  const oldFile = path.join(root, filename(oldVersion));
  const newFile = path.join(root, filename(version));
  await fs.writeFile(oldFile, oldBytes);
  await fs.writeFile(newFile, newBytes);
  await buildBlockMap(oldFile, 'gzip', oldFile + '.blockmap');
  const info = await buildBlockMap(newFile, 'gzip', newFile + '.blockmap');
  const blockmaps = new Map<string, Buffer>([
    [`/${filename(version)}.blockmap`, await fs.readFile(newFile + '.blockmap')],
  ]);
  if (options.oldBlockmap !== false) {
    blockmaps.set(`/${filename(oldVersion)}.blockmap`, await fs.readFile(oldFile + '.blockmap'));
  }
  const requests: string[] = [];
  let transferred = 0;
  let fullDownloads = 0;
  const server = createServer((req, res) => {
    const pathname = new URL(req.url!, 'http://localhost').pathname;
    if (/^\/latest(?:-linux|-mac)?\.yml$/.test(pathname)) {
      res.end(
        JSON.stringify({
          version,
          files: [{ url: filename(version), ...info }],
          path: filename(version),
          sha512: info.sha512,
        }),
      );
      return;
    }
    const map = blockmaps.get(pathname);
    if (map) {
      res.end(map);
      return;
    }
    if (pathname !== `/${filename(version)}`) {
      res.writeHead(404).end();
      return;
    }
    const range = req.headers.range;
    if (!range || options.rangeResponse === RangeResponse.Whole) {
      transferred += newBytes.length;
      fullDownloads++;
      const bytes = Buffer.from(newBytes);
      if (options.corruptFull) bytes[0] ^= 255;
      res.writeHead(200, { 'Content-Length': bytes.length }).end(bytes);
      return;
    }
    requests.push(range);
    if (options.rangeResponse === RangeResponse.Disconnect) {
      req.socket.destroy();
      return;
    }
    const match = /^bytes=(\d+)-(\d+)$/.exec(range);
    if (!match) {
      res.writeHead(400).end();
      return;
    }
    const start = Number(match[1]);
    const end = Number(match[2]);
    const bytes = Buffer.from(newBytes.subarray(start, end + 1));
    if (options.rangeResponse === RangeResponse.Corrupt) bytes[0] ^= 255;
    transferred += bytes.length;
    res
      .writeHead(206, {
        'Content-Length': bytes.length,
        'Content-Range': `bytes ${start}-${end}/${newBytes.length}`,
        'Accept-Ranges': 'bytes',
      })
      .end(bytes);
  });
  fixtures.push({ root, server });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing HTTP fixture address');
  const configPath = path.join(root, 'app-update.yml');
  await fs.writeFile(configPath, 'updaterCacheDirName: updater-cache\n');
  const cache = path.join(root, 'updater-cache');
  if (options.seedInstaller !== false) {
    await fs.mkdir(cache);
    await fs.writeFile(path.join(cache, 'installer.exe'), oldBytes);
  }
  const updater = new NsisUpdater(undefined, {
    version: oldVersion,
    name: 'ZhiYuan',
    isPackaged: true,
    appUpdateConfigPath: configPath,
    userDataPath: root,
    baseCachePath: root,
    whenReady: async () => {},
    relaunch() {},
    quit() {},
    onQuit() {},
  });
  const executor = new ElectronHttpExecutor();
  // Keep the native updater, hashing and fallback; only replace Electron's transport with Node HTTP.
  Object.assign(executor, {
    createRequest: (opts: RequestOptions, callback: (response: IncomingMessage) => void) =>
      request(opts, callback),
  });
  Object.assign(updater, { httpExecutor: executor });
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  updater.logger = logger;
  updater.setFeedURL({
    ...electronUpdaterFeedOptions(AppUpdateReleaseChannel.Stable, {
      platform: 'win32',
      arch: 'x64',
      variant: 'lite',
    }),
    url: `http://127.0.0.1:${address.port}/`,
  });
  return {
    updater,
    newBytes,
    requests,
    logger,
    cache,
    newFile,
    stats: () => ({ transferred, fullDownloads }),
  };
}

test('native updater reconstructs an exact update over single ranges while reusing the old installer', async () => {
  const f = await fixture();
  expect((await f.updater.checkForUpdates())?.isUpdateAvailable).toBe(true);
  const [downloaded] = await f.updater.downloadUpdate();
  expect(await fs.readFile(downloaded)).toEqual(f.newBytes);
  expect(f.requests.length).toBeGreaterThan(1);
  expect(f.requests.every(range => !range.includes(','))).toBe(true);
  expect(f.stats().fullDownloads).toBe(0);
  expect(f.stats().transferred).toBeLessThan(f.newBytes.length / 4);
  expect(
    JSON.parse(gunzipSync(await fs.readFile(path.join(f.cache, 'current.blockmap'))).toString())
      .files.length,
  ).toBe(1);
});

test('a first full update becomes a usable baseline for the next differential update', async () => {
  const first = await fixture({ seedInstaller: false });
  await first.updater.checkForUpdates();
  const [firstUpdate] = await first.updater.downloadUpdate();
  const second = await fixture({
    oldBytes: await fs.readFile(firstUpdate),
    oldVersion: '2026.11.24-build.3',
    version: '2026.11.24-build.4',
  });
  await second.updater.checkForUpdates();
  const [secondUpdate] = await second.updater.downloadUpdate();
  expect(await fs.readFile(secondUpdate)).toEqual(second.newBytes);
  expect(first.stats().fullDownloads).toBe(1);
  expect(second.stats().fullDownloads).toBe(0);
  expect(second.stats().transferred).toBeLessThan(second.newBytes.length / 4);
});

test.each([
  { name: 'first update without an old installer', seedInstaller: false },
  { name: 'expired or missing old blockmap', oldBlockmap: false },
  { name: 'CDN ignores ranges', rangeResponse: RangeResponse.Whole },
  { name: 'range bytes fail the final checksum', rangeResponse: RangeResponse.Corrupt },
  { name: 'connection drops during a range request', rangeResponse: RangeResponse.Disconnect },
])('native updater falls back to a verified full file: $name', async options => {
  const f = await fixture(options);
  await f.updater.checkForUpdates();
  const [downloaded] = await f.updater.downloadUpdate();
  expect(await fs.readFile(downloaded)).toEqual(f.newBytes);
  expect(f.stats().fullDownloads).toBeGreaterThan(0);
  expect(f.logger.error).toHaveBeenCalledWith(expect.stringContaining('fallback to full download'));
});

test('rejects a corrupt full fallback without making it available to install', async () => {
  const f = await fixture({ rangeResponse: RangeResponse.Corrupt, corruptFull: true });
  const downloaded = vi.fn();
  f.updater.on('update-downloaded', downloaded);
  await f.updater.checkForUpdates();
  await expect(f.updater.downloadUpdate()).rejects.toThrow(/sha512 checksum mismatch/);
  expect(downloaded).not.toHaveBeenCalled();
  expect(f.stats().fullDownloads).toBe(1);
});
