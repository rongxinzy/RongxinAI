import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const { KYLIN_ENV, buildKylin } = require('../build-kylin.cjs') as {
  KYLIN_ENV: Record<string, string>;
  buildKylin(options: {
    run: (command: string, args: string[]) => { status: number };
    platform: NodeJS.Platform;
    arch: string;
  }): void;
};
const { cleanGoEnvironment } = require('../build-magpie-runtime.cjs') as {
  cleanGoEnvironment(
    cacheRoot: string,
    target: { goos: string; goarch: string },
  ): Record<string, string>;
};

describe('Kylin packaging', () => {
  test('uses the Chinese default and CPU runtime', () => {
    expect(KYLIN_ENV).toMatchObject({
      ZHIYUAN_DEFAULT_LOCALE: 'zh-CN',
      ZHIYUAN_UPDATE_VARIANT: 'cpu',
      ZHIYUAN_DISTRIBUTION: 'kylin-v11',
    });
  });

  test('disables the Ubuntu AppImage update channel for the Kylin package', () => {
    const hooks = readFileSync(
      path.join(process.cwd(), 'scripts/electron-builder-hooks.cjs'),
      'utf8',
    );
    const kylinGuard = hooks.indexOf("process.env.ZHIYUAN_DISTRIBUTION === 'kylin-v11'");
    const linuxUrl = hooks.indexOf('stable/linux/x64/appimage-${edition}');
    expect(kylinGuard).toBeGreaterThan(-1);
    expect(linuxUrl).toBeGreaterThan(kylinGuard);
    expect(hooks).toContain('Kylin V11 package: auto-update metadata disabled');
  });

  test('uses the Kylin Go module proxy without changing the default builder contract', () => {
    const previous = process.env.ZHIYUAN_GO_PROXY;
    try {
      process.env.ZHIYUAN_GO_PROXY = 'https://goproxy.cn,direct';
      const env = cleanGoEnvironment('/tmp/magpie', { goos: 'linux', goarch: 'amd64' });
      expect(env.GOPROXY).toBe('https://goproxy.cn,direct');
      expect(env.GOSUMDB).toBe('sum.golang.org');
    } finally {
      if (previous === undefined) delete process.env.ZHIYUAN_GO_PROXY;
      else process.env.ZHIYUAN_GO_PROXY = previous;
    }
  });

  test('downloads CPU llama.cpp archives through curl and a Kylin mirror', () => {
    const downloader = readFileSync(
      path.join(process.cwd(), 'scripts/sync-vendor-llamacpp-cpu-edition.cjs'),
      'utf8',
    );
    const workflow = readFileSync(
      path.join(process.cwd(), '.github/workflows/build-kylin-release.yml'),
      'utf8',
    );
    expect(downloader).toContain('function downloadWithCurl');
    expect(downloader).toContain("'--retry'");
    expect(workflow).toContain('LLAMACPP_RUNTIME_BASE_URL=');
    expect(workflow).toContain('https://gh-proxy.com/https://github.com/');
  });

  test('builds Magpie runtime resources before the RPM installer', () => {
    const calls: string[][] = [];
    buildKylin({
      platform: 'linux',
      arch: 'x64',
      run: (command, args) => {
        calls.push([command, ...args]);
        return { status: 0 };
      },
    });
    expect(calls.map(call => call.join(' '))).toEqual([
      'bun run channel:runtime:linux-x64',
      'bun run engram:runtime:linux-x64',
      'node scripts/ensure-build-version.js',
      'bun run sync:vendor-llamacpp-cpu',
      'bun run prepare:inference-edition-runtime',
      'bun run build',
      'bun run build:skills',
      'bunx electron-builder --linux rpm --x64 --config electron-builder.kylin.cjs --publish never',
    ]);
  });

  test('packages only the Kylin RPM target with a stable ASCII filename', () => {
    const config = require('../../electron-builder.kylin.cjs') as {
      linux: {
        target: string[];
        artifactName: string;
        publish: unknown[];
        desktop: { entry: Record<string, string> };
      };
    };
    expect(config.linux.target).toEqual(['rpm']);
    expect(config.linux.publish).toEqual([]);
    expect(config.linux.artifactName).toBe('ZhiYuanAgent-Kylin-V11-${version}-${arch}.${ext}');
    expect(config.linux.desktop.entry).toMatchObject({
      Name: '知远智能体',
      Categories: 'Utility;Development;',
    });
  });

  test('wires the package script to the Kylin build entrypoint', () => {
    const packageJson = JSON.parse(
      readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'),
    ) as { scripts: Record<string, string> };
    expect(packageJson.scripts['dist:kylin:x64']).toBe('node scripts/build-kylin.cjs');
  });
});
