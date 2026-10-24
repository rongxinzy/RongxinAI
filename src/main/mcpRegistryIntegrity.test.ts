import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { expect, test } from 'vitest';

import { mcpRegistry as rendererFallbackRegistry } from '../renderer/data/mcpRegistry';

// src/main -> repo root
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const mcpsRoot = path.join(repoRoot, 'MCPs');

interface RegistryServer {
  id: string;
  name: string;
  category: string;
  transportType: string;
  authType: string;
  connectorPath?: string;
  iconPath?: string;
  metadataPath?: string;
}

interface BundledRegistry {
  categories: Array<{ id: string }>;
  servers: RegistryServer[];
}

function loadRegistry(): BundledRegistry {
  return JSON.parse(
    fs.readFileSync(path.join(mcpsRoot, 'registry.json'), 'utf8'),
  ) as BundledRegistry;
}

/** Connector directories expose either an mcp.json (remote/HTTP) or cli.json (feishu CLI). */
function listConnectorDirs(): string[] {
  return fs
    .readdirSync(mcpsRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .filter(
      name =>
        fs.existsSync(path.join(mcpsRoot, name, 'mcp.json')) ||
        fs.existsSync(path.join(mcpsRoot, name, 'cli.json')),
    );
}

test('mcpRegistryIntegrity: every registry server id has a directory under MCPs/', () => {
  const registry = loadRegistry();
  expect(registry.servers.length).toBeGreaterThan(0);

  const missing = registry.servers
    .filter(server => !fs.statSync(path.join(mcpsRoot, server.id)).isDirectory())
    .map(server => server.id);
  expect(missing).toEqual([]);
});

test('mcpRegistryIntegrity: every connector directory under MCPs/ is registered', () => {
  const registry = loadRegistry();
  // Only list directories that must stay unregistered here.
  const allowlist: string[] = [];

  const registered = new Set(registry.servers.map(server => server.id));
  const orphans = listConnectorDirs().filter(
    dir => !registered.has(dir) && !allowlist.includes(dir),
  );
  expect(orphans).toEqual([]);
});

test('mcpRegistryIntegrity: registry paths (connector/icon/metadata) exist on disk', () => {
  const registry = loadRegistry();
  const missing: string[] = [];

  for (const server of registry.servers) {
    for (const [label, relative] of [
      ['connectorPath', server.connectorPath],
      ['iconPath', server.iconPath],
      ['metadataPath', server.metadataPath],
    ] as const) {
      if (!relative) {
        missing.push(`${server.id}: missing ${label}`);
      } else if (!fs.existsSync(path.join(mcpsRoot, relative))) {
        missing.push(`${server.id}: ${label} ${relative} not found`);
      }
    }
  }
  expect(missing).toEqual([]);
});

test('mcpRegistryIntegrity: transportType stays within the app enum', () => {
  const registry = loadRegistry();
  const invalid = registry.servers
    .filter(server => !['stdio', 'sse', 'http'].includes(server.transportType))
    .map(server => `${server.id}:${server.transportType}`);
  expect(invalid).toEqual([]);
});

test('mcpRegistryIntegrity: renderer fallback registry equals the official registry', () => {
  const registry = loadRegistry();
  const officialIds = registry.servers.map(server => server.id);
  const fallbackIds = rendererFallbackRegistry.map(entry => entry.id);

  expect([...fallbackIds].sort()).toEqual([...officialIds].sort());

  // Core connection fields must not drift between fallback and official entries.
  const officialById = new Map(registry.servers.map(server => [server.id, server]));
  const drifted = rendererFallbackRegistry
    .filter(entry => {
      const server = officialById.get(entry.id);
      if (!server) return true;
      return (
        entry.transportType !== server.transportType ||
        entry.authType !== server.authType ||
        entry.url !== server.url ||
        entry.category !== server.category
      );
    })
    .map(entry => entry.id);
  expect(drifted).toEqual([]);
});

test('mcpRegistryIntegrity: renderer mcpRegistry.json stays in sync with the official registry', () => {
  const registry = loadRegistry();
  const mirror = JSON.parse(
    fs.readFileSync(path.join(repoRoot, 'src/renderer/data/mcpRegistry.json'), 'utf8'),
  ) as { servers: Array<{ id: string }> };

  expect(mirror.servers.map(server => server.id)).toEqual(registry.servers.map(s => s.id));
});
