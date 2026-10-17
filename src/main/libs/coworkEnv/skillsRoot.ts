import { app } from 'electron';
import { existsSync } from 'fs';
import { join } from 'path';

/**
 * Get SKILLs directory path (handles both development and production)
 */
export function getSkillsRoot(): string {
  if (app.isPackaged) {
    // In production, SKILLs are copied to userData
    return join(app.getPath('userData'), 'SKILLs');
  }

  // In development, __dirname can vary with bundling output (e.g. dist-electron/ or dist-electron/libs/).
  // Resolve from several stable anchors and pick the first existing SKILLs directory.
  const envRoots = [process.env.ZHIYUAN_SKILLS_ROOT, process.env.SKILLS_ROOT]
    .map(value => value?.trim())
    .filter((value): value is string => Boolean(value));
  const candidates = [
    ...envRoots,
    join(app.getAppPath(), 'SKILLs'),
    join(process.cwd(), 'SKILLs'),
    join(__dirname, '..', '..', 'SKILLs'),
    join(__dirname, '..', '..', '..', 'SKILLs'),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  // Final fallback for first-run dev environments where SKILLs may not exist yet.
  return join(app.getAppPath(), 'SKILLs');
}
