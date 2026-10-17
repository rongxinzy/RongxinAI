import fs from 'fs';
import path from 'path';

import { SKILL_FILE_NAME } from './constants';
import { resolveWithin } from './skillMarkdown';
import type { SkillManagerContext, SkillRecord } from './types';
import { isWindowsDeletePermissionError, tryWindowsDeleteFallbackAsync } from './windowsFs';

export async function deleteSkillImpl(
  ctx: SkillManagerContext,
  id: string,
): Promise<SkillRecord[]> {
  const root = ctx.ensureSkillsRoot();
  if (id !== path.basename(id)) {
    throw new Error('Invalid skill id');
  }
  if (ctx.isBuiltInSkillId(id)) {
    throw new Error('Built-in skills cannot be deleted');
  }
  if (ctx.deletingSkillIds.has(id)) {
    throw new Error(`Skill "${id}" is already being deleted`);
  }

  ctx.deletingSkillIds.add(id);
  try {
    return await performDelete(ctx, id, root);
  } finally {
    ctx.deletingSkillIds.delete(id);
  }
}

async function performDelete(
  ctx: SkillManagerContext,
  id: string,
  root: string,
): Promise<SkillRecord[]> {
  let targetDir: string | null = resolveWithin(root, id);
  if (!fs.existsSync(targetDir)) {
    const bundledRoot = ctx.getBundledSkillsRoot();
    if (bundledRoot && bundledRoot !== root) {
      const bundledTarget = resolveWithin(bundledRoot, id);
      targetDir = fs.existsSync(bundledTarget) ? bundledTarget : null;
    } else {
      targetDir = null;
    }
  }

  console.log(
    '[skills] deleteSkill: id=%s, targetDir=%s, platform=%s',
    id,
    targetDir,
    process.platform,
  );

  // Release directory handles held by fs.watch() before deleting;
  // on Windows, open handles prevent rmSync from removing the directory.
  ctx.stopWatching();
  // On Windows, watcher.close() triggers an async kernel operation to release
  // the directory handle. Yield to the event loop so the handle is fully
  // released before we attempt deletion.
  if (process.platform === 'win32') {
    await new Promise<void>(resolve => setTimeout(resolve, 100));
  }
  try {
    if (targetDir !== null) {
      let removedByFallback = false;
      const startMs = Date.now();
      try {
        await fs.promises.rm(targetDir, {
          recursive: true,
          force: true,
          maxRetries: process.platform === 'win32' ? 5 : 0,
          retryDelay: process.platform === 'win32' ? 200 : 0,
        });
      } catch (error) {
        if (!isWindowsDeletePermissionError(error)) {
          throw error;
        }
        const fallback = await tryWindowsDeleteFallbackAsync(targetDir);
        if (!fallback.success) {
          console.warn(
            '[skills] deleteSkill: Windows fallback failed for "%s": %s',
            id,
            fallback.detail || 'unknown',
          );
          // Last resort: remove SKILL.md so listSkillDirs won't discover this
          // directory, then rename it to a tombstone cleaned up on next startup.
          try {
            const skillMdPath = path.join(targetDir, SKILL_FILE_NAME);
            if (fs.existsSync(skillMdPath)) {
              fs.unlinkSync(skillMdPath);
            }
            const tombstone = targetDir + '.deleted.' + Date.now();
            fs.renameSync(targetDir, tombstone);
            console.warn(
              '[skills] deleteSkill: directory renamed to tombstone "%s" as last resort',
              path.basename(tombstone),
            );
            removedByFallback = true;
          } catch (renameError) {
            console.error('[skills] deleteSkill: last-resort rename also failed:', renameError);
            throw error;
          }
        } else {
          removedByFallback = true;
        }
      }
      if (removedByFallback) {
        console.warn(
          '[skills] deleteSkill: directory removed via Windows fallback in %dms',
          Date.now() - startMs,
        );
      } else {
        console.log('[skills] deleteSkill: directory removed in %dms', Date.now() - startMs);
      }
    } else {
      console.warn('[skills] deleteSkill: directory not found on disk, cleaning state only');
    }
    const state = ctx.loadSkillStateMap();
    delete state[id];
    ctx.saveSkillStateMap(state);
    ctx.notifySkillsChanged();
    console.log('[skills] deleteSkill: completed successfully for "%s"', id);
    return ctx.listSkills();
  } catch (error) {
    console.error('[skills] deleteSkill: failed to remove "%s" at %s:', id, targetDir, error);
    throw error;
  } finally {
    ctx.startWatching();
  }
}
