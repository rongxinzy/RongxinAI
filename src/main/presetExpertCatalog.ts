import fs from 'fs';
import path from 'path';

import {
  type ExpertPythonRequirements,
  type ExpertSkillCatalogEntry,
  readPresetExpertPackageMetadata,
} from '../shared/expert/presetPackageMetadata';
import { PRESET_EXPERTS_DIR, readPresetText } from './presetExpertSnapshot';

export const PresetCatalogLimit = {
  Entries: 256,
  ResultCharacters: 2_000_000,
} as const;

interface LocalizedText {
  en: string;
  zh: string;
}

export interface PresetExpertCatalogEntry {
  name: string;
  displayName: LocalizedText;
  profession: LocalizedText;
  displayDescription: LocalizedText;
  categoryId: string;
  tags: LocalizedText[];
  quickPrompts: LocalizedText[];
  workflow: string[];
  path: string;
  mcpIds: string[];
  pythonRequirements?: ExpertPythonRequirements;
  pypiMirrors: string[];
  skillCatalog: ExpertSkillCatalogEntry[];
}

const WORKFLOW_HEADING_PATTERN = /(?:标准.*(?:流程|SOP)|全流程|组件开发.*SOP)/i;
const PHASE_HEADING_PATTERN = /^###\s+Phase\s+\d+\s*[：:]?\s*(.+)$/i;

export function extractPresetExpertWorkflow(markdown: string): string[] {
  const workflowHeading = Array.from(markdown.matchAll(/^##\s+(.+)$/gim)).find(match =>
    WORKFLOW_HEADING_PATTERN.test(match[1]),
  );
  const lines = markdown.slice(workflowHeading?.index ?? 0).split(/\r?\n/);
  const steps: string[] = [];

  for (const line of lines) {
    const phaseMatch = line.match(PHASE_HEADING_PATTERN);
    if (phaseMatch) {
      steps.push(phaseMatch[1].trim());
      continue;
    }
    if (steps.length > 0 && /^##\s+/.test(line)) break;
  }

  return steps;
}

function readWorkflow(presetDir: string, agentPaths: unknown): string[] {
  if (!Array.isArray(agentPaths)) return [];

  for (const agentPath of agentPaths) {
    if (typeof agentPath !== 'string') continue;
    const resolvedPath = path.resolve(presetDir, agentPath);
    if (!resolvedPath.startsWith(`${path.resolve(presetDir)}${path.sep}`)) continue;
    if (!fs.existsSync(resolvedPath)) continue;

    return extractPresetExpertWorkflow(readPresetText(resolvedPath));
  }

  return [];
}

export function listPresetExperts(bundledSkillsRoot: string): PresetExpertCatalogEntry[] {
  const presetsDir = path.join(bundledSkillsRoot, ...PRESET_EXPERTS_DIR);
  if (!fs.existsSync(presetsDir)) return [];

  const directories = fs
    .readdirSync(presetsDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory());
  if (directories.length > PresetCatalogLimit.Entries) {
    throw new Error('Bundled expert catalog exceeds the supported entry limit.');
  }

  let remaining: number = PresetCatalogLimit.ResultCharacters;
  const experts: PresetExpertCatalogEntry[] = [];
  for (const entry of directories) {
    const presetDir = path.join(presetsDir, entry.name);
    const pluginPath = path.join(presetDir, 'plugin.json');
    if (!fs.existsSync(pluginPath)) continue;

    try {
      const plugin = JSON.parse(readPresetText(pluginPath)) as Record<string, unknown>;
      const packageMetadata = readPresetExpertPackageMetadata(plugin);
      const expert: PresetExpertCatalogEntry = {
        name: plugin.name as string,
        displayName: plugin.displayName as LocalizedText,
        profession: plugin.profession as LocalizedText,
        displayDescription: plugin.displayDescription as LocalizedText,
        categoryId: plugin.categoryId as string,
        tags: plugin.tags as LocalizedText[],
        quickPrompts: plugin.quickPrompts as LocalizedText[],
        workflow: readWorkflow(presetDir, plugin.agents),
        path: presetDir,
        mcpIds: packageMetadata.mcpIds,
        pythonRequirements: packageMetadata.pythonRequirements,
        pypiMirrors: packageMetadata.pypiMirrors,
        skillCatalog: packageMetadata.skillCatalog,
      };
      remaining -= JSON.stringify(expert).length;
      if (remaining >= 0) experts.push(expert);
    } catch (error) {
      console.warn(`[PresetExpertCatalog] skipped invalid preset in ${entry.name}:`, error);
    }
    if (remaining < 0) throw new Error('Bundled expert catalog exceeds the supported size limit.');
  }

  return experts;
}
