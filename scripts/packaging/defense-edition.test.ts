import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';

const {
  defenseSkills,
  isDefensePackage,
  prepareDefenseSkills,
  verifyDefenseResources,
  verifyDefenseAsar,
} = require('./defense-edition.cjs') as {
  defenseSkills: string[];
  isDefensePackage: (context: { packager: { config: { appId: string } } }) => boolean;
  prepareDefenseSkills: (root: string) => string;
  verifyDefenseResources: (root: string, platform?: string) => void;
  verifyDefenseAsar: (root: string) => void;
};

test('defense installer isolates its identity, update feed and output', () => {
  const config = require('../../electron-builder.defense.cjs');
  const publicConfig = require('../../electron-builder.json');
  expect(config.appId).toBe('com.zhiyuanagent.defense');
  expect(isDefensePackage({ packager: { config } })).toBe(true);
  expect(isDefensePackage({ packager: { config: publicConfig } })).toBe(false);
  expect(config.extraMetadata.name).toBe('zhiyuan-defense');
  expect(config.extraMetadata.productName).toBe(config.productName);
  expect(config.directories.output).not.toBe(publicConfig.directories.output);
  expect(config.win.publish).toBeNull();
  expect(config.protocols).toEqual([]);
  expect(config.win.target).toEqual(['nsis']);
  expect(config.nsis.include).toBe('scripts/nsis-installer.defense.nsh');
  expect(config.nsis.license).toBe('build/installer-assets/license.txt');
  expect(config.extraResources).toContainEqual({ from: 'LICENSE', to: 'LICENSE.txt' });
  expect(
    config.files.find((entry: { from?: string }) => entry.from === 'dist-electron').filter,
  ).toEqual(
    expect.arrayContaining([
      '!llamacppModelDaemonEntry.js',
      '!catalogWorker.js',
      '!appUpdateHashWorker.js',
    ]),
  );
});

test('verifies packaged identity and detects standalone pet pages in the ASAR', async () => {
  const { createPackage } = require('@electron/asar');
  const root = mkdtempSync(path.join(tmpdir(), 'defense-asar-'));
  try {
    const source = path.join(root, 'source');
    mkdirSync(path.join(source, 'dist'), { recursive: true });
    writeFileSync(
      path.join(source, 'package.json'),
      JSON.stringify({ name: 'zhiyuan-defense', productName: '知远智能体 国防版' }),
    );
    const archive = path.join(root, 'app.asar');
    await createPackage(source, archive);
    expect(() => verifyDefenseAsar(root)).toThrow('python-runtime-runner.js');
    mkdirSync(path.join(source, 'dist-electron'));
    for (const worker of ['python-runtime-runner.js', 'requestWorker.js']) {
      writeFileSync(path.join(source, 'dist-electron', worker), '/* fixture */');
    }
    await createPackage(source, archive);
    expect(() => verifyDefenseAsar(root)).not.toThrow();

    const daemon = path.join(source, 'dist-electron', 'llamacppModelDaemonEntry.js');
    writeFileSync(daemon, '/* stale standard build output */');
    await createPackage(source, archive);
    expect(() => verifyDefenseAsar(root)).toThrow('llamacppModelDaemonEntry.js');
    rmSync(daemon);
    writeFileSync(path.join(source, 'dist', 'desktop-pet.html'), '<html></html>');
    await createPackage(source, archive);
    expect(() => verifyDefenseAsar(root)).toThrow('Unexpected defense package entry');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('stages only offline skills and rejects leaked or incomplete package resources', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'defense-package-'));
  const write = (relativePath: string, content = 'fixture') => {
    const file = path.join(root, relativePath);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
  };
  try {
    for (const skill of [...defenseSkills, 'web-search']) write(`SKILLs/${skill}/SKILL.md`);
    write(
      'SKILLs/skills.config.json',
      JSON.stringify({ defaults: { 'web-search': { enabled: true }, docx: { enabled: true } } }),
    );
    const staged = prepareDefenseSkills(root);
    const config = JSON.parse(readFileSync(path.join(staged, 'skills.config.json'), 'utf8'));
    expect(Object.keys(config.defaults)).toEqual(defenseSkills);
    expect(config.defaults['web-search']).toBeUndefined();

    write('app-update.yml');
    expect(() => verifyDefenseResources(root)).toThrow('Unexpected defense package resource');
    rmSync(path.join(root, 'app-update.yml'));
    expect(() => verifyDefenseResources(root)).toThrow('LICENSE.txt');
    for (const file of [
      'LICENSE.txt',
      'memory/engram.exe',
      'memory/LICENSE',
      'mingit/usr/bin/bash.exe',
      'python-runtime/job-runner.exe',
      'python-win/python.exe',
      'skill-python/layers/shared/Scripts/python.exe',
      'uv-win/uv.exe',
      'vc_redist.x64.exe',
      'defense-python/requirements.txt',
      'defense-python/wheels/offline.whl',
    ]) {
      write(file);
    }
    write(
      'defense-python/runtime.json',
      JSON.stringify({ platform: 'win32', arch: 'x64', wheels: ['offline.whl'] }),
    );
    expect(() => verifyDefenseResources(root)).toThrow('SKILLs/docx/runtime');
    rmSync(path.join(root, 'SKILLs/web-search'), { recursive: true });
    write('SKILLs/skills.config.json', JSON.stringify(config));
    write('SKILLs/docx/runtime/MiniMaxAIDocx.Cli.exe');
    write('SKILLs/presentation-studio/node_modules/pptxgenjs/package.json');
    write('SKILLs/presentation-studio/node_modules/image-size/package.json');
    mkdirSync(path.join(root, 'mingit/dev/shm'), { recursive: true });
    mkdirSync(path.join(root, 'mingit/dev/mqueue'));
    expect(() => verifyDefenseResources(root)).not.toThrow();
    for (const file of [
      'memory/engram',
      'python-linux/bin/python3',
      'skill-python/layers/shared/bin/python3',
      'uv-linux/uv',
      'SKILLs/docx/runtime/MiniMaxAIDocx.Cli',
    ])
      write(file);
    expect(() => verifyDefenseResources(root, 'linux')).toThrow('does not match its manifest');
    write(
      'defense-python/runtime.json',
      JSON.stringify({ platform: 'linux', arch: 'x64', wheels: ['offline.whl'] }),
    );
    expect(() => verifyDefenseResources(root, 'linux')).not.toThrow();
    write('defense-python/wheels/unexpected.whl');
    expect(() => verifyDefenseResources(root, 'linux')).toThrow('does not match its manifest');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
