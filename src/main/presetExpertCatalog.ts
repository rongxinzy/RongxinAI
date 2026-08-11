import fs from 'fs';
import path from 'path';

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

    return extractPresetExpertWorkflow(fs.readFileSync(resolvedPath, 'utf-8'));
  }

  return [];
}

export function listPresetExperts(bundledSkillsRoot: string): PresetExpertCatalogEntry[] {
  const presetsDir = path.join(bundledSkillsRoot, 'zhiyuan-expert-manager', 'presets');
  if (!fs.existsSync(presetsDir)) return [];

  return fs
    .readdirSync(presetsDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .flatMap(entry => {
      const presetDir = path.join(presetsDir, entry.name);
      const pluginPath = path.join(presetDir, 'plugin.json');
      if (!fs.existsSync(pluginPath)) return [];

      try {
        const plugin = JSON.parse(fs.readFileSync(pluginPath, 'utf-8'));
        return [
          {
            name: plugin.name,
            displayName: plugin.displayName,
            profession: plugin.profession,
            displayDescription: plugin.displayDescription,
            categoryId: plugin.categoryId,
            tags: plugin.tags,
            quickPrompts: plugin.quickPrompts,
            workflow: readWorkflow(presetDir, plugin.agents),
            path: presetDir,
          },
        ];
      } catch (error) {
        console.warn(`[PresetExpertCatalog] skipped invalid preset in ${entry.name}:`, error);
        return [];
      }
    });
}
