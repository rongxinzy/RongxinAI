import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, test } from 'vitest';

import {
  LLAMACPP_NSIS_HELPER_RESOURCES_DIR,
  LLAMACPP_NSIS_HELPER_RUNTIME_PACKAGES,
  LLAMACPP_NSIS_HELPER_SCRIPT,
  configureMacAutoUpdateMetadata,
  prepareWindowsLlamaCppBackendResources,
  prepareWindowsLlamaCppNsisHelperResources,
  resolveWindowsLlamaCppBackendBundleMode,
  WindowsLlamaCppBackendBundleMode,
} from '../scripts/electron-builder-hooks.cjs';

describe('electron-builder packaging hooks', () => {
  test('marks macOS automatic installation disabled unless signing explicitly enables it', () => {
    const context = {
      electronPlatformName: 'darwin',
      packager: { config: { extraMetadata: { retained: true } } },
    };

    configureMacAutoUpdateMetadata(context, {});
    expect(context.packager.config.extraMetadata).toEqual({
      retained: true,
      zhiyuanMacAutoUpdateEnabled: false,
    });

    configureMacAutoUpdateMetadata(context, { ZHIYUAN_MAC_AUTO_UPDATE_ENABLED: 'true' });
    expect(context.packager.config.extraMetadata).toEqual({
      retained: true,
      zhiyuanMacAutoUpdateEnabled: true,
    });
  });

  test('defaults Windows llama.cpp backend bundle mode to lite', () => {
    expect(resolveWindowsLlamaCppBackendBundleMode({})).toBe(WindowsLlamaCppBackendBundleMode.Lite);
    expect(
      resolveWindowsLlamaCppBackendBundleMode({ ZHIYUAN_WIN_LLAMACPP_BACKEND_BUNDLE: 'full' }),
    ).toBe(WindowsLlamaCppBackendBundleMode.Full);
    expect(resolveWindowsLlamaCppBackendBundleMode({ WIN_LLAMACPP_BACKEND_BUNDLE: 'none' })).toBe(
      WindowsLlamaCppBackendBundleMode.None,
    );
    expect(() =>
      resolveWindowsLlamaCppBackendBundleMode({ ZHIYUAN_WIN_LLAMACPP_BACKEND_BUNDLE: 'bad' }),
    ).toThrow(/Expected lite, full, or none/);
  });

  test('stages win-lite backend resources without local archives', () => {
    const resources = prepareWindowsLlamaCppBackendResources(WindowsLlamaCppBackendBundleMode.Lite);
    expect(resources?.prefix).toBe('llamacpp-backends');
    expect(fs.existsSync(path.join(resources.dir, 'manifest.json'))).toBe(true);
    expect(fs.readdirSync(resources.dir).filter(entry => entry.endsWith('.zip'))).toEqual([]);
  });

  test('stages NSIS helper script with runtime package closure', () => {
    const resources = prepareWindowsLlamaCppNsisHelperResources();
    expect(resources.prefix).toBe(LLAMACPP_NSIS_HELPER_RESOURCES_DIR);
    expect(fs.existsSync(path.join(resources.dir, LLAMACPP_NSIS_HELPER_SCRIPT))).toBe(true);

    for (const packageName of LLAMACPP_NSIS_HELPER_RUNTIME_PACKAGES) {
      expect(
        fs.existsSync(
          path.join(resources.dir, 'node_modules', ...packageName.split('/'), 'package.json'),
        ),
      ).toBe(true);
    }

    expect(fs.existsSync(path.join(resources.dir, 'node_modules', 'yauzl', 'package.json'))).toBe(
      true,
    );
    expect(fs.existsSync(path.join(resources.dir, 'node_modules', 'pump', 'package.json'))).toBe(
      true,
    );
    const closure = JSON.parse(
      fs.readFileSync(path.join(resources.dir, 'package-closure.json'), 'utf8'),
    );
    expect(closure.script).toBe(LLAMACPP_NSIS_HELPER_SCRIPT);
    expect(closure.packages).toContain('extract-zip');
    expect(closure.packages).toContain('node-downloader-helper');
  });
});
