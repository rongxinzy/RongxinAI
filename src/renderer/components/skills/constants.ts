export const SkillTab = {
  Installed: 'installed',
  Marketplace: 'marketplace',
} as const;

export const SKILL_PAGE_SIZE = 14;

export type SkillTab = (typeof SkillTab)[keyof typeof SkillTab];

export const SkillCategory = {
  All: 'all',
  Writing: 'writing',
  Marketing: 'marketing',
  Development: 'development',
  Data: 'data',
  Research: 'research',
  Collaboration: 'collaboration',
  Legal: 'legal',
  Search: 'search',
} as const;

export type SkillCategory = (typeof SkillCategory)[keyof typeof SkillCategory];

export const skillCategories: SkillCategory[] = [
  SkillCategory.All,
  SkillCategory.Writing,
  SkillCategory.Marketing,
  SkillCategory.Development,
  SkillCategory.Data,
  SkillCategory.Research,
  SkillCategory.Collaboration,
  SkillCategory.Legal,
  SkillCategory.Search,
];

export const SkillCategoryTranslationKey = {
  [SkillCategory.All]: 'skillCategoryAll',
  [SkillCategory.Writing]: 'skillCategoryWriting',
  [SkillCategory.Marketing]: 'skillCategoryMarketing',
  [SkillCategory.Development]: 'skillCategoryDevelopment',
  [SkillCategory.Data]: 'skillCategoryData',
  [SkillCategory.Research]: 'skillCategoryResearch',
  [SkillCategory.Collaboration]: 'skillCategoryCollaboration',
  [SkillCategory.Legal]: 'skillCategoryLegal',
  [SkillCategory.Search]: 'skillCategorySearch',
} as const;

const skillCategoryIds: Record<Exclude<SkillCategory, 'all'>, ReadonlySet<string>> = {
  writing: new Set([
    'humanizer-zh',
    'copywriting',
    'copy-editing',
    'copy-editor',
    'marketing-writer',
    'ad-copywriter',
    'ad-creative',
    'ecom-copy-assistant',
    'customer-reply-craft',
    'xindaya-translator',
  ]),
  marketing: new Set([
    'campaign-plan',
    'campaign-planner',
    'seo-audit',
    'churn-prevention',
    'saas-analyzer',
    'saas-metrics-coach',
  ]),
  development: new Set([
    'code-arch-optimizer',
    'code-safety-audit',
    'code-to-chart',
    'git-repo-audit',
    'log-diagnostic',
    'py-perf-analyzer',
    'programming-tutor',
    'smart-commit-gen',
    'web-security-audit',
  ]),
  data: new Set(['database-inspector', 'sql-tutor', 'regression-insight']),
  research: new Set([
    'content-research-writer',
    'research-writer',
    'research-advisor',
    'scientific-problem-selection',
    'paper-review-coach',
    'research-paper-refiner',
  ]),
  collaboration: new Set([
    'imap-smtp-email',
    'meeting-recap',
    'process-doc',
    'zhiyuan-expert-manager',
  ]),
  legal: new Set(['legal-contract-gen', 'legal-risk-analyzer', 'legal-risk-assessment']),
  search: new Set(['web-search']),
};

export function getSkillCategory(skillId: string): SkillCategory {
  for (const [category, ids] of Object.entries(skillCategoryIds)) {
    if (ids.has(skillId)) return category as Exclude<SkillCategory, 'all'>;
  }
  return SkillCategory.All;
}

export function isSkillCategory(value: string): value is SkillCategory {
  return Object.values(SkillCategory).includes(value as SkillCategory);
}

export const SkillToolbarPlacement = {
  Inline: 'inline',
  ExpertHeader: 'expert-header',
} as const;

export type SkillToolbarPlacement =
  (typeof SkillToolbarPlacement)[keyof typeof SkillToolbarPlacement];

export function isSkillTab(value: string): value is SkillTab {
  return Object.values(SkillTab).includes(value as SkillTab);
}
