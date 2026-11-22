import fs from 'fs';
import path from 'path';

import { SKILLS_CONFIG_FILE, SKILL_FILE_NAME } from './constants';
import { compareVersions, parseFrontmatter } from './skillMarkdown';
import type { SkillsConfig } from './types';
import { inspectWebSearchRuntime } from './webSearchRuntime';

const BUNDLED_STAGING_PREFIX = '.bundled-sync-';
const WEB_SEARCH_CONTROL_FILE = '.server-control.local.json';
const {
  access,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  rename,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
} = fs.promises;
const exists = (file: string) =>
  access(file).then(
    () => true,
    () => false,
  );

const readSkillVersion = async (skillDir: string): Promise<string> => {
  try {
    const raw = await readFile(path.join(skillDir, SKILL_FILE_NAME), 'utf8');
    const { frontmatter } = parseFrontmatter(raw);
    const meta = frontmatter.metadata as Record<string, unknown> | undefined;
    const v = frontmatter.version ?? meta?.version;
    return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
  } catch {
    return '';
  }
};

/**
 * Check if a skill's runtime is healthy by comparing with bundled version.
 * Returns false if bundled has dependencies but target doesn't.
 */
const isSkillRuntimeHealthy = async (targetDir: string, bundledDir: string): Promise<boolean> => {
  const bundledRequirements = path.join(bundledDir, 'requirements.txt');
  if (await exists(bundledRequirements)) {
    try {
      const [bundled, target] = await Promise.all([
        readFile(bundledRequirements),
        readFile(path.join(targetDir, 'requirements.txt')),
      ]);
      if (!bundled.equals(target)) return false;
    } catch {
      return false;
    }
  }

  const bundledNodeModules = path.join(bundledDir, 'node_modules');
  const targetNodeModules = path.join(targetDir, 'node_modules');
  const targetPackageJson = path.join(targetDir, 'package.json');

  // If target has no package.json, it's a simple skill (no deps needed)
  if (!(await exists(targetPackageJson))) {
    return true;
  }

  // If bundled doesn't have node_modules, no deps to sync
  if (!(await exists(bundledNodeModules))) {
    return true;
  }

  // If bundled has node_modules but target doesn't, needs repair
  return exists(targetNodeModules);
};

const mergeSkillsConfig = async (bundledPath: string, targetPath: string): Promise<void> => {
  try {
    const [bundledJson, targetJson] = await Promise.all([
      readFile(bundledPath, 'utf8'),
      readFile(targetPath, 'utf8'),
    ]);
    const bundled = JSON.parse(bundledJson) as SkillsConfig;
    const target = JSON.parse(targetJson) as SkillsConfig;
    if (!bundled.defaults || !target.defaults) return;
    let changed = false;
    for (const [id, config] of Object.entries(bundled.defaults)) {
      if (!(id in target.defaults)) {
        target.defaults[id] = config;
        changed = true;
      }
    }
    for (const id of bundled.retired ?? []) {
      if (id in target.defaults) {
        delete target.defaults[id];
        changed = true;
      }
    }
    if (target.version < bundled.version) {
      // Keep every existing entry so upgrades retain the user's prior defaults.
      target.version = bundled.version;
      changed = true;
    }
    if (changed) {
      // Write to temp file first, then rename for atomic update
      const tmpPath = targetPath + '.tmp';
      await writeFile(tmpPath, JSON.stringify(target, null, 2) + '\n', 'utf-8');
      await rename(tmpPath, targetPath);
      console.log(
        '[skills] mergeSkillsConfig: migrated user config without replacing existing defaults',
      );
    }
  } catch (e) {
    console.warn('[skills] Failed to merge skills config:', e);
  }
};

export async function recoverInterruptedUpgrades(root: string): Promise<void> {
  if (!(await exists(root))) return;

  try {
    const entries = await readdir(root, { withFileTypes: true });
    for (const { name: entry } of entries.filter(item => item.isDirectory())) {
      if (
        entry.startsWith(BUNDLED_STAGING_PREFIX) &&
        /^[a-z0-9]{6}$/i.test(entry.slice(BUNDLED_STAGING_PREFIX.length))
      ) {
        await rm(path.join(root, entry), { recursive: true, force: true }).catch(error => {
          console.warn(
            `[SkillManager] failed to clear abandoned staging directory ${entry}:`,
            error,
          );
        });
        continue;
      }
      if (!entry.endsWith('.upgrading')) continue;
      const backupDir = path.join(root, entry);

      const originalName = entry.replace(/\.upgrading$/, '');
      const originalDir = path.join(root, originalName);

      try {
        if (await exists(path.join(originalDir, SKILL_FILE_NAME))) {
          // Upgrade completed successfully, clean up backup
          console.log(`[SkillManager] cleaning up completed upgrade backup: ${entry}`);
          await rm(backupDir, { recursive: true, force: true });
        } else {
          // Upgrade was interrupted, roll back
          console.log(`[SkillManager] rolling back interrupted upgrade for ${originalName}`);
          if (await exists(originalDir)) {
            await rm(originalDir, { recursive: true, force: true });
          }
          await rename(backupDir, originalDir);
        }
      } catch (error) {
        console.warn(`[SkillManager] failed to recover upgrade for ${entry}:`, error);
      }
    }
  } catch (error) {
    console.warn('[SkillManager] failed to recover interrupted upgrades:', error);
  }
}

export async function syncBundledSkillsToUserData(
  userRoot: string,
  bundledRoot: string,
): Promise<void> {
  console.log('[skills] syncBundledSkillsToUserData: start');
  console.log('[skills] syncBundledSkillsToUserData: userRoot =', userRoot);
  console.log('[skills] syncBundledSkillsToUserData: bundledRoot =', bundledRoot);
  if (!bundledRoot || bundledRoot === userRoot || !(await exists(bundledRoot))) {
    console.log(
      '[skills] syncBundledSkillsToUserData: bundledRoot skipped (missing or same as userRoot)',
    );
    return;
  }

  try {
    // Build allowlist of bundled skill IDs from skills.config.json so
    // user-added skill folders that happen to sit in the bundled root
    // (e.g. restored by the installer's AppData backup) are not synced
    // to user data. Falls back to the legacy "sync everything" behavior
    // if the config is missing or malformed.
    let bundledIds: Set<string> | null = null;
    let retiredBundledIds: string[] = [];
    try {
      const configPath = path.join(bundledRoot, SKILLS_CONFIG_FILE);
      if (await exists(configPath)) {
        const parsed = JSON.parse(await readFile(configPath, 'utf8'));
        if (parsed?.defaults && typeof parsed.defaults === 'object') {
          bundledIds = new Set(Object.keys(parsed.defaults));
        }
        if (Array.isArray(parsed?.retired)) {
          retiredBundledIds = parsed.retired.filter(
            (id: unknown): id is string => typeof id === 'string',
          );
        }
      }
    } catch (error) {
      console.warn('[skills] Failed to parse skills.config.json for sync filter:', error);
    }

    const bundledSkillDirs = (await exists(path.join(bundledRoot, SKILL_FILE_NAME)))
      ? [bundledRoot]
      : (await readdir(bundledRoot, { withFileTypes: true }))
          .filter(entry => entry.isDirectory() || entry.isSymbolicLink())
          .map(entry => path.join(bundledRoot, entry.name));
    console.log(
      '[skills] syncBundledSkillsToUserData: found',
      bundledSkillDirs.length,
      'bundled skills',
    );
    for (const dir of bundledSkillDirs) {
      const id = path.basename(dir);
      if (bundledIds && !bundledIds.has(id)) {
        console.log(`[skills] syncBundledSkillsToUserData: skipping non-bundled "${id}"`);
        continue;
      }
      if (!(await exists(path.join(dir, SKILL_FILE_NAME)))) continue;
      const targetDir = path.join(userRoot, id);
      const targetExists = await exists(targetDir);

      // Check if skill needs repair
      let shouldRepair = false;
      let needsCleanCopy = false;
      if (targetExists) {
        // Version-based update: if bundled has a version and it's newer, force update
        const [bundledVer, targetVer] = await Promise.all([
          readSkillVersion(dir),
          readSkillVersion(targetDir),
        ]);
        if (bundledVer && compareVersions(bundledVer, targetVer || '0.0.0') > 0) {
          shouldRepair = true;
          needsCleanCopy = true;
        }
        // web-search has specific broken checks
        else if (id === 'web-search' && !(await inspectWebSearchRuntime(targetDir)).ready) {
          shouldRepair = true;
        }
        // Generic check: if bundled has node_modules but target doesn't, repair it
        else if (!(await isSkillRuntimeHealthy(targetDir, dir))) {
          shouldRepair = true;
        }
      }

      if (targetExists && !shouldRepair) continue;
      try {
        console.log(
          `[skills] syncBundledSkillsToUserData: copying "${id}" from ${dir} to ${targetDir}`,
        );

        await installBundledSkill(dir, targetDir, needsCleanCopy);

        console.log(`[skills] syncBundledSkillsToUserData: copied "${id}" successfully`);
        if (shouldRepair) {
          console.log(`[skills] Repaired bundled skill "${id}" in user data`);
        }
      } catch (error) {
        console.warn(`[skills] Failed to sync bundled skill "${id}":`, error);
      }
    }

    // A retired bundled ID is an explicit product migration, not a generic
    // cleanup rule: only IDs declared by the bundle are removed from user data.
    for (const id of retiredBundledIds) {
      if (!id || id === '.' || id === '..' || path.basename(id) !== id) continue;
      const targetDir = path.join(userRoot, id);
      if (!(await exists(targetDir))) continue;
      try {
        await rm(targetDir, { recursive: true, force: true });
        console.log(`[skills] Removed retired bundled skill "${id}" from user data`);
      } catch (error) {
        console.warn(`[skills] Failed to remove retired bundled skill "${id}":`, error);
      }
    }

    const bundledConfig = path.join(bundledRoot, SKILLS_CONFIG_FILE);
    const targetConfig = path.join(userRoot, SKILLS_CONFIG_FILE);
    if (await exists(bundledConfig)) {
      if (!(await exists(targetConfig))) {
        console.log('[skills] syncBundledSkillsToUserData: copying skills.config.json');
        await copyFile(bundledConfig, targetConfig, fs.constants.COPYFILE_EXCL);
      } else {
        await mergeSkillsConfig(bundledConfig, targetConfig);
      }
    }
    console.log('[skills] syncBundledSkillsToUserData: done');
  } catch (error) {
    console.warn('[skills] Failed to sync bundled skills:', error);
  }
}

export async function restoreBundledSkillDependencies(
  bundled: string,
  target: string,
): Promise<void> {
  const source = path.join(bundled, 'node_modules');
  if (!(await stat(source)).isDirectory())
    throw new Error('Bundled node_modules is not a directory');
  const root = await fs.promises.realpath(target);
  const staging = await mkdtemp(path.join(path.dirname(root), BUNDLED_STAGING_PREFIX));
  const incoming = path.join(staging, 'node_modules');
  try {
    await copySkillTree(source, incoming, true);
    await rename(incoming, path.join(root, 'node_modules'));
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

async function installBundledSkill(bundled: string, target: string, clean = false): Promise<void> {
  const targetExists = await exists(target);
  const staging = await mkdtemp(path.join(path.dirname(target), BUNDLED_STAGING_PREFIX));
  const incoming = path.join(staging, 'incoming');
  const backup = target + '.upgrading';
  try {
    if (targetExists && !clean) {
      await copySkillTree(target, incoming, false);
    }
    await copySkillTree(bundled, incoming, true);
    if (clean) {
      const localFiles =
        path.basename(target) === 'web-search' ? ['.env', WEB_SEARCH_CONTROL_FILE] : ['.env'];
      for (const name of localFiles) {
        const original = path.join(target, name);
        try {
          await copyFile(original, path.join(incoming, name));
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
      }
    }
    // Publish the complete tree without yielding across the replacement.
    if (targetExists) fs.renameSync(target, backup);
    try {
      fs.renameSync(incoming, target);
    } catch (error) {
      if (targetExists) fs.renameSync(backup, target);
      throw error;
    }
    if (targetExists) {
      fs.renameSync(backup, path.join(staging, 'previous'));
    }
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

// The Electron fs wrappers support bundled ASAR paths and Windows Unicode paths.
async function copySkillTree(
  source: string,
  destination: string,
  dereference: boolean,
): Promise<void> {
  const sourceStat = await (dereference ? stat : lstat)(source);
  const destinationStat = await lstat(destination).catch((error: NodeJS.ErrnoException): null => {
    if (error.code !== 'ENOENT') throw error;
    return null;
  });
  if (destinationStat?.isSymbolicLink()) await unlink(destination);
  if (sourceStat.isDirectory()) {
    await mkdir(destination, { recursive: true });
    for (const entry of await readdir(source)) {
      await copySkillTree(path.join(source, entry), path.join(destination, entry), dereference);
    }
  } else if (sourceStat.isFile()) {
    await copyFile(source, destination);
  } else if (sourceStat.isSymbolicLink()) {
    await symlink(await readlink(source), destination);
  }
}
