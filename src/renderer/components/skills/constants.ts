export const SkillTab = {
  Installed: 'installed',
  Marketplace: 'marketplace',
} as const;

export type SkillTab = (typeof SkillTab)[keyof typeof SkillTab];

export const SkillToolbarPlacement = {
  Inline: 'inline',
  ExpertHeader: 'expert-header',
} as const;

export type SkillToolbarPlacement =
  (typeof SkillToolbarPlacement)[keyof typeof SkillToolbarPlacement];

export function isSkillTab(value: string): value is SkillTab {
  return Object.values(SkillTab).includes(value as SkillTab);
}
