import { skillService } from '../../../services/skill';
import { Skill, MarketplaceSkill } from '../../../types/skill';
import { getSkillCategory, SkillCategory } from '../constants';

/**
 * Shared matching helpers for the Skills manager.
 *
 * All of these are pure functions extracted from SkillsManager so the
 * marketplace/installed matching rules (id, leaf id, normalized name,
 * displayName) live in one testable place instead of being re-inlined at
 * every call site.
 */

/** Lowercase, trim and collapse whitespace/underscores/hyphens to hyphens. */
export function normalizeSkillName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '-');
}

/**
 * Find the local skill that corresponds to a marketplace listing.
 *
 * Matches by exact id, by the marketplace id's leaf segment, or by
 * normalized name/displayName. Used when opening a marketplace skill's
 * document and when selecting the freshly installed skill after install.
 */
export function findInstalledSkillForMarketplace(
  skills: Skill[],
  marketplaceSkill: MarketplaceSkill,
): Skill | undefined {
  const normalizedName = marketplaceSkill.name
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '-');
  const marketplaceLeafId = marketplaceSkill.id.split('/').pop()?.toLowerCase();
  return skills.find(
    skill =>
      skill.id === marketplaceSkill.id ||
      skill.id.toLowerCase() === marketplaceLeafId ||
      skill.name
        .trim()
        .toLowerCase()
        .replace(/[\s_-]+/g, '-') === normalizedName ||
      skill.displayName
        ?.trim()
        .toLowerCase()
        .replace(/[\s_-]+/g, '-') === normalizedName,
  );
}

/**
 * Whether a marketplace listing is already installed. Stricter than
 * {@link findInstalledSkillForMarketplace}: only exact id or normalized name
 * count as installed for the badge on marketplace cards and dialogs.
 */
export function isMarketplaceSkillInstalled(
  skills: Skill[],
  marketplaceSkill: MarketplaceSkill,
): boolean {
  const normalizedName = marketplaceSkill.name
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '-');
  return skills.some(
    skill =>
      skill.id === marketplaceSkill.id ||
      skill.name
        .trim()
        .toLowerCase()
        .replace(/[\s_-]+/g, '-') === normalizedName,
  );
}

/**
 * Pre-install guard for the marketplace install button: exact id or
 * normalized name match means the install would be a no-op.
 */
export function isMarketplaceSkillAlreadyInstalled(
  skills: Skill[],
  marketplaceSkill: MarketplaceSkill,
): boolean {
  const requestedName = normalizeSkillName(marketplaceSkill.name);
  return skills.some(
    skill => skill.id === marketplaceSkill.id || normalizeSkillName(skill.name) === requestedName,
  );
}

/**
 * Normalized name set of installed skills (name + displayName), used to
 * render "already installed" state on marketplace cards. Blank values are
 * skipped.
 */
export function buildInstalledSkillNames(skills: Skill[]): Set<string> {
  return new Set(
    skills.flatMap(skill =>
      [skill.name, skill.displayName]
        .filter((value): value is string => Boolean(value?.trim()))
        .map(value => normalizeSkillName(value)),
    ),
  );
}

/** Map marketplace skill id → listing name, used for installed card names. */
export function buildMarketplaceNameMap(
  marketplaceSkills: MarketplaceSkill[],
): Map<string, string> {
  const map = new Map<string, string>();
  marketplaceSkills.forEach(skill => map.set(skill.id, skill.name));
  return map;
}

/**
 * Filter installed skills by category tab and free-text query. The query
 * matches name/displayName/description/displayDescription plus the
 * localized description service lookup.
 */
export function filterInstalledSkills(
  skills: Skill[],
  skillCategory: SkillCategory,
  searchQuery: string,
): Skill[] {
  const query = searchQuery.trim().replace(/\s+/g, ' ').toLowerCase();
  return skills.filter(skill => {
    const matchesCategory =
      skillCategory === SkillCategory.All || getSkillCategory(skill.id) === skillCategory;
    if (!matchesCategory || !query) return matchesCategory;
    return [
      skill.name,
      skill.displayName,
      skill.description,
      skill.displayDescription,
      skillService.getLocalizedSkillDescription(skill.id, skill.name, skill.description),
    ]
      .filter((value): value is string => Boolean(value))
      .join(' ')
      .toLowerCase()
      .includes(query);
  });
}
