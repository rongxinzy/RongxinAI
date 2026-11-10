/**
 * Core built-in skills.
 *
 * These skills back first-class product entries (the Chat quick-skill
 * shortcuts and home quick actions). They are always enabled: the user must
 * not be able to disable them, because the entries that depend on them
 * cannot be removed.
 */
export const CoreSkillId = {
  PresentationStudio: 'presentation-studio',
  Docx: 'docx',
  Xlsx: 'xlsx',
  DeepResearch: 'deep-research',
  ZhiyuanAutoResearch: 'deli-autoresearch',
  WebSearch: 'web-search',
  FrontendDesign: 'frontend-design',
} as const;

export type CoreSkillId = (typeof CoreSkillId)[keyof typeof CoreSkillId];

export const DefenseSkillId = {
  OperationsDocumentWriting: 'operations-document-writing',
  CommandPostExerciseDocuments: 'command-post-exercise-documents',
} as const;

export type DefenseSkillId = (typeof DefenseSkillId)[keyof typeof DefenseSkillId];

export const isCoreSkill = (id: string): id is CoreSkillId | DefenseSkillId =>
  ([...Object.values(CoreSkillId), ...Object.values(DefenseSkillId)] as string[]).includes(id);

/** Skills that together form the first-class Academic Research workflow. */
export const AcademicResearchSkillIds = [
  CoreSkillId.ZhiyuanAutoResearch,
  CoreSkillId.DeepResearch,
  CoreSkillId.WebSearch,
] as const;

const defenseQuickActionSkills = new Set<string>([
  DefenseSkillId.OperationsDocumentWriting,
  DefenseSkillId.CommandPostExerciseDocuments,
  CoreSkillId.Docx,
  CoreSkillId.Xlsx,
]);

export const isDefenseQuickActionSkill = (id: string): boolean => defenseQuickActionSkills.has(id);
