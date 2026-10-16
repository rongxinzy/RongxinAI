import fs from 'fs';
import path from 'path';

import { cpRecursiveSync } from '../fsCompat';
import { SKILLS_CONFIG_FILE, SKILL_FILE_NAME } from './constants';
import { listSkillDirs } from './skillDirs';
import { compareVersions, hasMatchingBundledRequirements, parseFrontmatter } from './skillMarkdown';
import type { SkillsConfig } from './types';

const isWebSearchSkillBroken = (skillRoot: string): boolean => {
  const startServerScript = path.join(skillRoot, 'scripts', 'start-server.sh');
  const searchScript = path.join(skillRoot, 'scripts', 'search.sh');
  const serverEntry = path.join(skillRoot, 'dist', 'server', 'index.js');
  const requiredPaths = [
    startServerScript,
    searchScript,
    serverEntry,
    path.join(skillRoot, 'node_modules', 'iconv-lite', 'encodings', 'index.js'),
  ];

  if (requiredPaths.some(requiredPath => !fs.existsSync(requiredPath))) {
    return true;
  }

  try {
    const startScript = fs.readFileSync(startServerScript, 'utf-8');
    const searchScriptContent = fs.readFileSync(searchScript, 'utf-8');
    const serverEntryContent = fs.readFileSync(serverEntry, 'utf-8');
    if (!startScript.includes('WEB_SEARCH_FORCE_REPAIR')) {
      return true;
    }
    if (!startScript.includes('detect_healthy_bridge_server')) {
      return true;
    }
    if (!searchScriptContent.includes('ACTIVE_SERVER_URL')) {
      return true;
    }
    if (!searchScriptContent.includes('try_switch_to_local_server')) {
      return true;
    }
    if (!searchScriptContent.includes('build_search_payload')) {
      return true;
    }
    if (!searchScriptContent.includes('@query_file')) {
      return true;
    }
    if (!serverEntryContent.includes('decodeJsonRequestBody')) {
      return true;
    }
    if (!serverEntryContent.includes("TextDecoder('gb18030'")) {
      return true;
    }
    if (
      serverEntryContent.includes('scoreDecodedJsonText') &&
      serverEntryContent.includes('Request body decoded using gb18030 (score')
    ) {
      return true;
    }
  } catch {
    return true;
  }

  return false;
};

const readSkillVersion = (skillDir: string): string => {
  try {
    const raw = fs.readFileSync(path.join(skillDir, SKILL_FILE_NAME), 'utf8');
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
const isSkillRuntimeHealthy = (targetDir: string, bundledDir: string): boolean => {
  if (!hasMatchingBundledRequirements(targetDir, bundledDir)) {
    return false;
  }

  const bundledNodeModules = path.join(bundledDir, 'node_modules');
  const targetNodeModules = path.join(targetDir, 'node_modules');
  const targetPackageJson = path.join(targetDir, 'package.json');

  // If target has no package.json, it's a simple skill (no deps needed)
  if (!fs.existsSync(targetPackageJson)) {
    return true;
  }

  // If bundled doesn't have node_modules, no deps to sync
  if (!fs.existsSync(bundledNodeModules)) {
    return true;
  }

  // If bundled has node_modules but target doesn't, needs repair
  if (!fs.existsSync(targetNodeModules)) {
    return false;
  }

  return true;
};

const mergeSkillsConfig = (bundledPath: string, targetPath: string): void => {
  try {
    const bundled = JSON.parse(fs.readFileSync(bundledPath, 'utf-8')) as SkillsConfig;
    const target = JSON.parse(fs.readFileSync(targetPath, 'utf-8')) as SkillsConfig;
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
      fs.writeFileSync(tmpPath, JSON.stringify(target, null, 2) + '\n', 'utf-8');
      fs.renameSync(tmpPath, targetPath);
      console.log(
        '[skills] mergeSkillsConfig: migrated user config without replacing existing defaults',
      );
    }
  } catch (e) {
    console.warn('[skills] Failed to merge skills config:', e);
  }
};

export function recoverInterruptedUpgrades(root: string): void {
  if (!fs.existsSync(root)) return;

  try {
    const entries = fs.readdirSync(root);
    for (const entry of entries) {
      if (!entry.endsWith('.upgrading')) continue;
      const backupDir = path.join(root, entry);
      const stat = fs.statSync(backupDir);
      if (!stat.isDirectory()) continue;

      const originalName = entry.replace(/\.upgrading$/, '');
      const originalDir = path.join(root, originalName);

      try {
        if (fs.existsSync(originalDir) && fs.existsSync(path.join(originalDir, SKILL_FILE_NAME))) {
          // Upgrade completed successfully, clean up backup
          console.log(`[SkillManager] cleaning up completed upgrade backup: ${entry}`);
          fs.rmSync(backupDir, { recursive: true, force: true });
        } else {
          // Upgrade was interrupted, roll back
          console.log(
            `[SkillManager] rolling back interrupted upgrade: ${entry} 鈫?${originalName}`,
          );
          if (fs.existsSync(originalDir)) {
            fs.rmSync(originalDir, { recursive: true, force: true });
          }
          fs.renameSync(backupDir, originalDir);
        }
      } catch (error) {
        console.warn(`[SkillManager] failed to recover upgrade for ${entry}:`, error);
      }
    }
  } catch (error) {
    console.warn('[SkillManager] failed to recover interrupted upgrades:', error);
  }
}

export function syncBundledSkillsToUserData(userRoot: string, bundledRoot: string): void {
  console.log('[skills] syncBundledSkillsToUserData: start');
  console.log('[skills] syncBundledSkillsToUserData: userRoot =', userRoot);
  console.log('[skills] syncBundledSkillsToUserData: bundledRoot =', bundledRoot);
  if (!bundledRoot || bundledRoot === userRoot || !fs.existsSync(bundledRoot)) {
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
      if (fs.existsSync(configPath)) {
        const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
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

    const bundledSkillDirs = listSkillDirs(bundledRoot);
    console.log(
      '[skills] syncBundledSkillsToUserData: found',
      bundledSkillDirs.length,
      'bundled skills',
    );
    bundledSkillDirs.forEach(dir => {
      const id = path.basename(dir);
      if (bundledIds && !bundledIds.has(id)) {
        console.log(`[skills] syncBundledSkillsToUserData: skipping non-bundled "${id}"`);
        return;
      }
      const targetDir = path.join(userRoot, id);
      const targetExists = fs.existsSync(targetDir);

      // Check if skill needs repair
      let shouldRepair = false;
      let needsCleanCopy = false;
      if (targetExists) {
        // Version-based update: if bundled has a version and it's newer, force update
        const bundledVer = readSkillVersion(dir);
        if (bundledVer && compareVersions(bundledVer, readSkillVersion(targetDir) || '0.0.0') > 0) {
          shouldRepair = true;
          needsCleanCopy = true;
        }
        // web-search has specific broken checks
        else if (id === 'web-search' && isWebSearchSkillBroken(targetDir)) {
          shouldRepair = true;
        }
        // Generic check: if bundled has node_modules but target doesn't, repair it
        else if (!isSkillRuntimeHealthy(targetDir, dir)) {
          shouldRepair = true;
        }
      }

      if (targetExists && !shouldRepair) return;
      try {
        console.log(
          `[skills] syncBundledSkillsToUserData: copying "${id}" from ${dir} to ${targetDir}`,
        );

        // Preserve .env file before clean copy
        let envBackup: Buffer | null = null;
        const envPath = path.join(targetDir, '.env');
        if (needsCleanCopy && fs.existsSync(envPath)) {
          envBackup = fs.readFileSync(envPath);
        }

        // Version-based update: delete target dir first to remove stale files
        // (e.g. old .py scripts, __pycache__, leftover package-lock.json)
        if (needsCleanCopy) {
          fs.rmSync(targetDir, { recursive: true, force: true });
        }

        cpRecursiveSync(dir, targetDir, {
          dereference: true,
          force: shouldRepair,
        });

        // Restore .env file after clean copy
        if (envBackup !== null) {
          fs.writeFileSync(envPath, envBackup);
        }

        console.log(`[skills] syncBundledSkillsToUserData: copied "${id}" successfully`);
        if (shouldRepair) {
          console.log(`[skills] Repaired bundled skill "${id}" in user data`);
        }
      } catch (error) {
        console.warn(`[skills] Failed to sync bundled skill "${id}":`, error);
      }
    });

    // A retired bundled ID is an explicit product migration, not a generic
    // cleanup rule: only IDs declared by the bundle are removed from user data.
    for (const id of retiredBundledIds) {
      const targetDir = path.join(userRoot, id);
      if (!fs.existsSync(targetDir)) continue;
      try {
        fs.rmSync(targetDir, { recursive: true, force: true });
        console.log(`[skills] Removed retired bundled skill "${id}" from user data`);
      } catch (error) {
        console.warn(`[skills] Failed to remove retired bundled skill "${id}":`, error);
      }
    }

    const bundledConfig = path.join(bundledRoot, SKILLS_CONFIG_FILE);
    const targetConfig = path.join(userRoot, SKILLS_CONFIG_FILE);
    if (fs.existsSync(bundledConfig)) {
      if (!fs.existsSync(targetConfig)) {
        console.log('[skills] syncBundledSkillsToUserData: copying skills.config.json');
        cpRecursiveSync(bundledConfig, targetConfig);
      } else {
        mergeSkillsConfig(bundledConfig, targetConfig);
      }
    }
    console.log('[skills] syncBundledSkillsToUserData: done');
  } catch (error) {
    console.warn('[skills] Failed to sync bundled skills:', error);
  }
}
