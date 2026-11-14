import { expect, test } from 'vitest';
import {
  durableManifestViolations,
  retiredRuntimeArtifact,
  retiredExecutionReferencePattern,
  retiredPackagingReferencePattern,
} from './retired-runtime-policy.cjs';

const manifest = {
  devDependencies: {
    '@earendil-works/pi-durable': '1.5.2',
    '@earendil-works/pi-ai': '1.5.2',
    '@earendil-works/pi-mcp': '1.5.2',
  },
};
test('requires Durable and rejects retired dependency, metadata, launch and lockfile routes', () => {
  expect(durableManifestViolations(manifest)).toEqual([]);
  expect(durableManifestViolations({})).not.toEqual([]);
  expect(
    durableManifestViolations({ ...manifest, dependencies: { '@sigrun/sigrun': '0.15.0' } }),
  ).not.toEqual([]);
  expect(
    durableManifestViolations(manifest, '"@sigrun/sigrun": ["@sigrun/sigrun@0.15.0"]'),
  ).not.toEqual([]);
  expect(
    durableManifestViolations(manifest, '"peerDependencies":{"@sigrun/sigrun":">=0.15.0"}'),
  ).toEqual([]);
  for (const name of [
    '@earendil-works/pi-coding-agent',
    '@earendil-works/pi-agent-core',
    'cc-connect',
    'engram',
  ]) {
    expect(
      durableManifestViolations({ ...manifest, dependencies: { [name]: '1.0.0' } }),
    ).not.toEqual([]);
  }
  for (const key of ['channelRuntime', 'engram'])
    expect(durableManifestViolations({ ...manifest, [key]: {} })).not.toEqual([]);
  for (const command of [
    'bun run channel:runtime:host',
    'node scripts/download-engram-runtime.cjs engram:runtime:host',
  ])
    expect(durableManifestViolations({ ...manifest, scripts: { build: command } })).not.toEqual([]);
  expect(
    durableManifestViolations(manifest, '"@earendil-works/pi-coding-agent@1.5.2"'),
  ).not.toEqual([]);
  expect(durableManifestViolations(manifest, '"@earendil-works/pi-agent-core": []')).not.toEqual(
    [],
  );
});
test('rejects retired packaged executables, archives and dependency directories on every OS', () => {
  for (const file of [
    'resources/channel-runtime/cc-connect-sidecar.exe',
    'resources/memory/engram.exe',
    'Contents/Resources/cc-connect-sidecar',
    'windows-components/channel-runtime.7z',
    'windows-components/channel-runtime.manifest.json',
    'node_modules/@earendil-works/pi-coding-agent/dist/index.js',
    'resources\\engram-runtime\\engram.exe',
  ])
    expect(retiredRuntimeArtifact(file), file).toBe(true);
  for (const file of [
    'resources/python-win/python.exe',
    'resources/skill-python/python.exe',
    'resources/magpie/win32-x64/magpie.exe',
    'resources/uv-win/uv.exe',
    'src/main/memory/markdownMemoryBackend.ts',
  ])
    expect(retiredRuntimeArtifact(file), file).toBe(false);
});
test('rejects old source imports and packaging inputs without blocking native SDKs', () => {
  for (const code of [
    "import { AgentSession } from '@earendil-works/pi-coding-agent';",
    "import { EngramManager } from '../memory/engramManager';",
    "require('./ccConnectSidecarManager');",
    'process.env.ENGRAM_HTTP_TOKEN',
  ])
    expect(retiredExecutionReferencePattern.test(code), code).toBe(true);
  for (const code of [
    "import { Harness } from '@earendil-works/pi-durable';",
    "import { createMemory } from '@sigrun/memory-markdown';",
  ])
    expect(retiredExecutionReferencePattern.test(code), code).toBe(false);
  expect(retiredPackagingReferencePattern.test('vendor/channel-runtime/current')).toBe(true);
  expect(retiredPackagingReferencePattern.test('vendor/engram-runtime/current')).toBe(true);
});
