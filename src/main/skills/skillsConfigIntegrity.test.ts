import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { expect, test } from 'vitest';

// src/main/skills -> repo root -> SKILLs/
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const skillsRoot = path.join(repoRoot, 'SKILLs');
const presetsRoot = path.join(skillsRoot, 'zhiyuan-expert-manager', 'presets');

interface SkillDefault {
  order?: number;
  enabled?: boolean;
}

interface SkillsConfig {
  version: number;
  retired: string[];
  defaults: Record<string, SkillDefault>;
}

interface ExpertPlugin {
  name: string;
  skillIds: string[];
  mcpIds?: string[];
}

function loadSkillsConfig(): SkillsConfig {
  const raw = fs.readFileSync(path.join(skillsRoot, 'skills.config.json'), 'utf-8');
  return JSON.parse(raw) as SkillsConfig;
}

function hasTopLevelSkillDir(id: string): boolean {
  return (
    fs.existsSync(path.join(skillsRoot, id)) && fs.statSync(path.join(skillsRoot, id)).isDirectory()
  );
}

interface PresetPlugins {
  preset: string;
  plugin: ExpertPlugin;
}

function loadPresetPlugins(): PresetPlugins[] {
  return fs
    .readdirSync(presetsRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(entry => {
      const plugin = JSON.parse(
        fs.readFileSync(path.join(presetsRoot, entry.name, 'plugin.json'), 'utf-8'),
      ) as ExpertPlugin;
      return { preset: entry.name, plugin };
    });
}

/** Collects directory names that contain a SKILL.md anywhere under a preset's skills/ folder. */
function collectNestedSkillIds(presetDir: string): Set<string> {
  const nested = new Set<string>();
  const walk = (dir: string): void => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const child = path.join(dir, entry.name);
      if (entry.isFile() && entry.name === 'SKILL.md') {
        nested.add(path.basename(dir));
      } else if (entry.isDirectory()) {
        walk(child);
      }
    }
  };
  walk(path.join(presetDir, 'skills'));
  return nested;
}

test('skillsConfigIntegrity: every default skill id has a directory under SKILLs/', () => {
  const config = loadSkillsConfig();
  const defaultIds = Object.keys(config.defaults);
  expect(defaultIds.length).toBeGreaterThan(0);

  const missing = defaultIds.filter(id => !hasTopLevelSkillDir(id));
  expect(missing).toEqual([]);
});

test('skillsConfigIntegrity: retired ids never appear in defaults', () => {
  const config = loadSkillsConfig();
  expect(config.retired.length).toBeGreaterThan(0);

  const overlap = config.retired.filter(id => id in config.defaults);
  expect(overlap).toEqual([]);
});

test('skillsConfigIntegrity: expert preset skillIds resolve to bundled or preset-nested skills', () => {
  const presets = loadPresetPlugins();
  expect(presets.length).toBeGreaterThan(0);

  const unresolved: string[] = [];
  for (const { preset, plugin } of presets) {
    const nestedIds = collectNestedSkillIds(path.join(presetsRoot, preset));
    for (const skillId of plugin.skillIds ?? []) {
      if (!hasTopLevelSkillDir(skillId) && !nestedIds.has(skillId)) {
        unresolved.push(`${preset}:${skillId}`);
      }
    }
  }
  expect(unresolved).toEqual([]);
});

test('skillsConfigIntegrity: expert preset skillIds never overlap retired ids', () => {
  const config = loadSkillsConfig();
  const presets = loadPresetPlugins();

  const allSkillIds = presets.flatMap(({ plugin }) => plugin.skillIds ?? []);
  const overlap = config.retired.filter(id => allSkillIds.includes(id));
  expect(overlap).toEqual([]);
});

test('skillsConfigIntegrity: expert presets do not reference retired pptx', () => {
  const presets = loadPresetPlugins();

  const offenders = presets.filter(({ plugin }) => (plugin.skillIds ?? []).includes('pptx'));
  expect(offenders.map(({ preset }) => preset)).toEqual([]);
});

test('skillsConfigIntegrity: bundled preset experts count at least eighteen', () => {
  const presets = loadPresetPlugins();
  expect(presets.length).toBeGreaterThanOrEqual(18);
});

test('skillsConfigIntegrity: expert preset mcpIds are non-empty strings when declared', () => {
  const presets = loadPresetPlugins();
  for (const { preset, plugin } of presets) {
    for (const mcpId of plugin.mcpIds ?? []) {
      expect(typeof mcpId, `${preset}: invalid mcpId`).toBe('string');
      expect(mcpId.trim().length, `${preset}: empty mcpId`).toBeGreaterThan(0);
    }
  }
});

function loadCuratedMcpCatalogIds(): Set<string> {
  const ids = new Set<string>();
  const bundled = JSON.parse(
    fs.readFileSync(path.join(repoRoot, 'MCPs/registry.json'), 'utf-8'),
  ) as { servers?: Array<{ id: string }> };
  const fallback = JSON.parse(
    fs.readFileSync(path.join(repoRoot, 'src/renderer/data/mcpRegistry.json'), 'utf-8'),
  ) as { servers?: Array<{ id: string }> };
  for (const server of bundled.servers ?? []) ids.add(server.id);
  for (const server of fallback.servers ?? []) ids.add(server.id);
  return ids;
}

test('skillsConfigIntegrity: expert preset mcpIds reference curated local MCP catalog ids', () => {
  const allowed = loadCuratedMcpCatalogIds();
  const presets = loadPresetPlugins();
  const unresolved: string[] = [];
  for (const { preset, plugin } of presets) {
    for (const mcpId of plugin.mcpIds ?? []) {
      if (!allowed.has(mcpId)) unresolved.push(`${preset}:${mcpId}`);
    }
  }
  expect(unresolved).toEqual([]);
});

test('skillsConfigIntegrity: MCP catalogs exclude abandoned GongRzhe/iflow office packages', () => {
  const paths = [
    path.join(repoRoot, 'MCPs/registry.json'),
    path.join(repoRoot, 'src/renderer/data/mcpRegistry.json'),
  ];
  for (const filePath of paths) {
    const text = fs.readFileSync(filePath, 'utf-8');
    expect(text.toLowerCase()).not.toContain('gongrzhe');
    expect(text.toLowerCase()).not.toContain('iflow-mcp');
  }
});

test('skillsConfigIntegrity: marketing-campaign-expert uses presentation-studio', () => {
  const presets = loadPresetPlugins();
  const marketing = presets.find(({ preset }) => preset === 'marketing-campaign-expert');

  expect(marketing).toBeDefined();
  expect(marketing?.plugin.skillIds).toContain('presentation-studio');
});
