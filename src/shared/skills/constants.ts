/**
 * Core built-in skills.
 *
 * These skills back first-class product entries (the Chat quick-skill
 * shortcuts and home quick actions). They are always enabled: the user must
 * not be able to disable them, because the entries that depend on them
 * cannot be removed.
 */
export const CoreSkillId = {
  Pptx: 'pptx',
  Docx: 'docx',
  Xlsx: 'xlsx',
  DeepResearch: 'deep-research',
  ZhiyuanAutoResearch: 'deli-autoresearch',
  WebSearch: 'web-search',
  FrontendDesign: 'frontend-design',
} as const;

export type CoreSkillId = (typeof CoreSkillId)[keyof typeof CoreSkillId];

export const isCoreSkill = (id: string): id is CoreSkillId =>
  (Object.values(CoreSkillId) as string[]).includes(id);

/** Skills that together form the first-class Academic Research workflow. */
export const AcademicResearchSkillIds = [
  CoreSkillId.ZhiyuanAutoResearch,
  CoreSkillId.DeepResearch,
  CoreSkillId.WebSearch,
] as const;
