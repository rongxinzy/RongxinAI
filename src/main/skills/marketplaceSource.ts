import {
  parseModelScopeSkillUrl,
  resolveModelScopeSkillInstallSource,
} from '../libs/modelscopeSkillMarketplace';

export async function resolveMarketplaceSkillSource(source: string): Promise<string | null> {
  const parsedModelScopeSkill = parseModelScopeSkillUrl(source);
  if (!parsedModelScopeSkill) {
    return source;
  }

  const resolvedSource = await resolveModelScopeSkillInstallSource(source);
  return resolvedSource;
}
