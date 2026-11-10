import fs from 'node:fs';
import path from 'node:path';

import { CoworkSessionExpertSource } from '../shared/cowork/sessionExperts';
import { DefenseSkillId } from '../shared/skills/constants';
import type { CreateAgentRequest } from './coworkStore';
import type { PresetExpertCatalogEntry } from './presetExpertCatalog';

const definitions = {
  [DefenseSkillId.OperationsDocumentWriting]: {
    name: '作战文书编写',
    profession: '作战文书拟制专家',
    description:
      '拟制和优化作战命令、目标、兵力部署、战术步骤及交战方案，支持校订、版本对照和脱敏。',
    quickPrompt: '根据提供的想定和既有材料，编写完整的作战文书并交付可编辑文档。',
  },
  [DefenseSkillId.CommandPostExerciseDocuments]: {
    name: '指挥所演习作战文书的编写和改写',
    profession: '指挥所演习文书专家',
    description: '编写和改写指挥所演习想定、命令、部署、战术步骤、交战方案与导调文书。',
    quickPrompt: '根据演习想定编写指挥所作业文书，并按新态势完成改写和版本对照。',
  },
} as const;

function readDefinition(skillsRoot: string, skillId: DefenseSkillId) {
  const definition = definitions[skillId];
  if (!definition) return null;
  const directory = path.join(skillsRoot, skillId);
  const skillPath = path.join(directory, 'SKILL.md');
  if (!fs.existsSync(skillPath)) return null;
  const markdown = fs.readFileSync(skillPath, 'utf8');
  const systemPrompt = markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim();
  if (!systemPrompt) return null;
  return { skillId, directory, definition, systemPrompt };
}

export function listDefenseExperts(skillsRoot: string): PresetExpertCatalogEntry[] {
  return Object.values(DefenseSkillId).flatMap((skillId): PresetExpertCatalogEntry[] => {
    const expert = readDefinition(skillsRoot, skillId);
    if (!expert) return [];
    const { name, profession, description, quickPrompt } = expert.definition;
    return [
      {
        name: skillId,
        displayName: { zh: name, en: name },
        profession: { zh: profession, en: profession },
        displayDescription: { zh: description, en: description },
        categoryId: 'defense-document-writing',
        tags: [{ zh: '作战文书', en: '作战文书' }],
        quickPrompts: [{ zh: quickPrompt, en: quickPrompt }],
        workflow: [],
        path: expert.directory,
        mcpIds: [],
        pypiMirrors: [],
        skillCatalog: [],
      },
    ];
  });
}

export function resolveDefenseExpert(
  skillsRoot: string,
  expertDirectory: string,
): CreateAgentRequest | null {
  const skillId = Object.values(DefenseSkillId).find(
    id => path.join(skillsRoot, id) === path.resolve(expertDirectory),
  );
  if (!skillId) return null;
  const expert = readDefinition(skillsRoot, skillId);
  if (!expert) return null;
  const { name, profession, description } = expert.definition;
  return {
    id: skillId,
    name,
    description,
    systemPrompt: expert.systemPrompt,
    identity: profession,
    skillIds: [skillId, 'docx', 'xlsx', 'pdf'],
    mcpIds: [],
    source: CoworkSessionExpertSource.Package,
    presetId: skillId,
  };
}
