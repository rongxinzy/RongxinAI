import type { Skill } from '../../types/skill';

const updatedAt = Date.UTC(2026, 9, 16, 7, 0, 0);

function defenseSkill(id: string, displayName: string, description: string): Skill {
  return {
    id,
    name: id,
    description,
    enabled: true,
    pinned: true,
    isOfficial: true,
    isBuiltIn: true,
    updatedAt,
    prompt: '',
    skillPath: `/app/build-tar/defense/SKILLs/${id}/SKILL.md`,
    displayName,
  };
}

export const mockDefenseSkills: Skill[] = [
  defenseSkill(
    'operations-document-writing',
    '作战文书编写',
    '编写和改写作战命令、目标、兵力部署、战术步骤与交战方案。',
  ),
  defenseSkill(
    'command-post-exercise-documents',
    '指挥所演习作战文书的编写和改写',
    '编写和改写指挥所演习想定、命令与配套文书。',
  ),
  defenseSkill('docx', 'Word 文档', '创建、编辑和排版 Word 文档。'),
  defenseSkill('xlsx', '表格', '创建、分析和编辑电子表格。'),
  defenseSkill('pdf', 'PDF 工具', '读取、生成和校验 PDF 文档。'),
];

export const mockDefenseExperts = mockDefenseSkills.slice(0, 2).map(skill => ({
  name: skill.id,
  displayName: { zh: skill.displayName ?? skill.name, en: skill.displayName ?? skill.name },
  profession: { zh: skill.displayName ?? skill.name, en: skill.displayName ?? skill.name },
  displayDescription: { zh: skill.description, en: skill.description },
  categoryId: 'defense-document-writing',
  tags: [{ zh: '作战文书', en: '作战文书' }],
  quickPrompts: [{ zh: skill.description, en: skill.description }],
  workflow: [],
  path: `/app/build-tar/defense/SKILLs/${skill.id}`,
  mcpIds: [],
  pypiMirrors: [],
  skillCatalog: [],
}));
