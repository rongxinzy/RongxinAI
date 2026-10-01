import fs from 'node:fs';
import path from 'node:path';

/**
 * Build the trusted roots used by run_skill_script.
 *
 * Skill ids are model-controlled input, but the roots are resolved from the
 * application-owned resource directories. Expert skills live below a preset
 * directory rather than directly below the main SKILLs root, so passing only
 * the global root makes their scripts appear to be missing.
 */
export function resolvePiSkillRoots(
  skillIds: string[] | undefined,
  regularRoots: readonly string[],
  expertSkillDirs: readonly string[],
): Record<string, string> {
  const roots: Record<string, string> = {};
  for (const rawSkillId of skillIds ?? []) {
    const skillId = rawSkillId.trim();
    if (!skillId || path.basename(skillId) !== skillId || roots[skillId]) continue;

    // Expert roots are checked first because an expert skill is selected as
    // part of the expert snapshot and must not accidentally resolve to a
    // same-named user Skill.
    const candidates = [...expertSkillDirs, ...regularRoots];
    const root = candidates.find(candidate =>
      fs.existsSync(path.join(candidate, skillId, 'SKILL.md')),
    );
    if (root) roots[skillId] = root;
  }
  return roots;
}
