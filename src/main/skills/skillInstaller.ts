import crypto from 'crypto';
import { app } from 'electron';
import extractZip from 'extract-zip';
import fs from 'fs';
import path from 'path';

import { cpRecursiveSync } from '../fsCompat';
import { t } from '../i18n';
import { mergeReports, scanMultipleSkillDirs } from '../libs/skillSecurity/skillSecurityScanner';
import type {
  SecurityReportAction,
  SkillSecurityReport,
} from '../libs/skillSecurity/skillSecurityTypes';
import { SKILL_FILE_NAME } from './constants';
import {
  downloadGithubArchive,
  downloadNpmPackage,
  downloadZipUrl,
  isNpmPackageSpec,
  isRemoteZipUrl,
} from './downloadUtils';
import {
  deriveRepoName,
  normalizeGitSource,
  parseGithubRepoSource,
  resolveGitCommand,
} from './gitUtils';
import { resolveMarketplaceSkillSource } from './marketplaceSource';
import { collectSkillDirsFromSource } from './skillDirs';
import {
  findDuplicateSkillName,
  isZipFile,
  normalizeFolderName,
  resolveWithin,
} from './skillMarkdown';
import type { SkillInstallOptions, SkillManagerContext, SkillRecord } from './types';
import { cleanupPathSafely, normalizeWindowsSkillDirectoryAttrs } from './windowsFs';
import { runCommand } from './processRunner';

export async function downloadSkillImpl(
  ctx: SkillManagerContext,
  source: string,
  options: SkillInstallOptions = {},
): Promise<{
  success: boolean;
  skills?: SkillRecord[];
  error?: string;
  auditReport?: SkillSecurityReport;
  pendingInstallId?: string;
}> {
  let cleanupPath: string | null = null;
  try {
    const trimmed = source.trim();
    if (!trimmed) {
      return { success: false, error: 'Missing skill source' };
    }

    const resolvedSource = await resolveMarketplaceSkillSource(trimmed);
    if (!resolvedSource) {
      return { success: false, error: t('skillErrModelScopeInstallUnavailable') };
    }

    console.log(`[SkillManager] downloadSkill: source="${trimmed}" resolved="${resolvedSource}"`);
    const root = ctx.ensureSkillsRoot();
    let localSource = resolvedSource;
    if (fs.existsSync(localSource)) {
      const stat = fs.statSync(localSource);
      if (stat.isFile()) {
        if (isZipFile(localSource)) {
          console.log('[SkillManager] downloadSkill: detected local zip file');
          const tempRoot = fs.mkdtempSync(path.join(app.getPath('temp'), 'zhiyuan-skill-zip-'));
          await extractZip(localSource, { dir: tempRoot });
          localSource = tempRoot;
          cleanupPath = tempRoot;
        } else if (path.basename(localSource) === SKILL_FILE_NAME) {
          console.log('[SkillManager] downloadSkill: detected local SKILL.md file');
          localSource = path.dirname(localSource);
        } else {
          return {
            success: false,
            error: 'Skill source must be a directory, zip file, or SKILL.md file',
          };
        }
      } else {
        console.log('[SkillManager] downloadSkill: detected local directory');
      }
    } else if (isRemoteZipUrl(resolvedSource)) {
      console.log('[SkillManager] downloadSkill: detected remote zip URL');
      const tempRoot = fs.mkdtempSync(path.join(app.getPath('temp'), 'zhiyuan-skill-zip-'));
      cleanupPath = tempRoot;
      localSource = await downloadZipUrl(resolvedSource, tempRoot);
    } else if (isNpmPackageSpec(resolvedSource)) {
      console.log(`[SkillManager] downloadSkill: detected npm package spec "${resolvedSource}"`);
      const tempRoot = fs.mkdtempSync(path.join(app.getPath('temp'), 'zhiyuan-skill-npm-'));
      cleanupPath = tempRoot;
      localSource = await downloadNpmPackage(resolvedSource, tempRoot);
      console.log(`[SkillManager] downloadSkill: npm package extracted to ${localSource}`);
    } else {
      const normalized = normalizeGitSource(resolvedSource);
      if (!normalized) {
        return { success: false, error: t('skillErrInvalidSource') };
      }
      const tempRoot = fs.mkdtempSync(path.join(app.getPath('temp'), 'zhiyuan-skill-'));
      cleanupPath = tempRoot;
      const repoName = normalizeFolderName(
        normalized.repoNameHint || deriveRepoName(normalized.repoUrl),
      );
      const clonePath = path.join(tempRoot, repoName);
      const githubSource = parseGithubRepoSource(normalized.repoUrl);
      let downloadedSourceRoot = clonePath;

      // Prefer HTTP zip download for GitHub repos (no git dependency required).
      // Fall back to git clone only for non-GitHub sources or if download fails.
      let downloaded = false;
      if (githubSource) {
        console.log(
          `[SkillManager] downloadSkill: trying GitHub HTTP zip download for ${githubSource.owner}/${githubSource.repo}`,
        );
        try {
          downloadedSourceRoot = await downloadGithubArchive(
            githubSource,
            tempRoot,
            normalized.ref,
          );
          downloaded = true;
          console.log(
            `[SkillManager] downloadSkill: GitHub HTTP download succeeded 鈫?${downloadedSourceRoot}`,
          );
        } catch (err) {
          console.log(
            `[SkillManager] downloadSkill: GitHub HTTP download failed: ${err instanceof Error ? err.message : err}, falling back to git clone`,
          );
        }
      }

      if (!downloaded) {
        console.log(`[SkillManager] downloadSkill: using git clone for ${normalized.repoUrl}`);
        const cloneArgs = ['clone', '--depth', '1'];
        if (normalized.ref) {
          cloneArgs.push('--branch', normalized.ref);
        }
        cloneArgs.push(normalized.repoUrl, clonePath);
        const gitRuntime = resolveGitCommand();
        try {
          await runCommand(gitRuntime.command, cloneArgs, { env: gitRuntime.env });
        } catch (error) {
          const errno = (error as NodeJS.ErrnoException | null)?.code;
          if (errno === 'ENOENT' && process.platform === 'win32') {
            throw new Error(
              'Failed to download skill. Git is not installed.' +
                ' Please install Git for Windows, or use a GitHub URL (HTTP download).',
            );
          }
          throw error;
        }
      }

      if (normalized.sourceSubpath) {
        const scopedSource = resolveWithin(downloadedSourceRoot, normalized.sourceSubpath);
        if (!fs.existsSync(scopedSource)) {
          return {
            success: false,
            error: `Path "${normalized.sourceSubpath}" not found in repository`,
          };
        }
        const scopedStat = fs.statSync(scopedSource);
        if (scopedStat.isFile()) {
          if (path.basename(scopedSource) === SKILL_FILE_NAME) {
            localSource = path.dirname(scopedSource);
          } else {
            return {
              success: false,
              error: 'GitHub path must point to a directory or SKILL.md file',
            };
          }
        } else {
          localSource = scopedSource;
        }
      } else {
        localSource = downloadedSourceRoot;
      }
    }

    const skillDirs = collectSkillDirsFromSource(localSource);
    if (skillDirs.length === 0) {
      cleanupPathSafely(cleanupPath);
      cleanupPath = null;
      return { success: false, error: t('skillErrNoSkillMd') };
    }

    const duplicateSkillName = findDuplicateSkillName(
      skillDirs,
      ctx.listSkills().map(skill => skill.name),
    );
    if (duplicateSkillName) {
      cleanupPathSafely(cleanupPath);
      cleanupPath = null;
      return {
        success: false,
        error: t('skillErrAlreadyInstalled', { name: duplicateSkillName }),
      };
    }

    // Security scan before installation
    let auditReport: SkillSecurityReport | null = null;
    try {
      console.log(`[SkillManager] Starting security scan for ${skillDirs.length} skill dir(s)...`);
      const reports = await scanMultipleSkillDirs(skillDirs);
      auditReport = mergeReports(reports);
      if (auditReport) {
        console.log(
          `[SkillManager] Security scan complete: riskLevel=${auditReport.riskLevel}, score=${auditReport.riskScore}, findings=${auditReport.findings.length}, duration=${auditReport.scanDurationMs}ms`,
        );
        for (const f of auditReport.findings) {
          console.log(
            `[SkillManager]   [${f.severity}] ${f.dimension} | ${f.ruleId} 鈫?${f.file}${f.line ? ':' + f.line : ''}`,
          );
        }
      }
    } catch (err) {
      console.warn('[SkillManager] Security scan failed (non-blocking):', err);
    }

    // If risk detected, cache for user confirmation instead of auto-installing
    if (auditReport && auditReport.riskLevel !== 'safe') {
      const pendingId = crypto.randomUUID();
      console.log(
        `[SkillManager] Risk detected (${auditReport.riskLevel}), pending user confirmation: ${pendingId}`,
      );
      const timer = setTimeout(
        () => {
          const pending = ctx.pendingInstalls.get(pendingId);
          if (pending) {
            cleanupPathSafely(pending.cleanupPath);
            ctx.pendingInstalls.delete(pendingId);
            console.log(`[SkillManager] Pending install ${pendingId} expired (TTL)`);
          }
        },
        5 * 60 * 1000,
      );

      ctx.pendingInstalls.set(pendingId, {
        tempDir: localSource,
        cleanupPath,
        root,
        skillDirs,
        timer,
        iconUrl: options.iconUrl,
        displayName: options.displayName,
      });

      return {
        success: true,
        auditReport,
        pendingInstallId: pendingId,
      };
    }

    // Safe or scan failed — install directly
    console.log(`[SkillManager] Skill is safe (or scan failed), installing directly`);
    const duplicateSkillNameBeforeInstall = findDuplicateSkillName(
      skillDirs,
      ctx.listSkills().map(skill => skill.name),
    );
    if (duplicateSkillNameBeforeInstall) {
      cleanupPathSafely(cleanupPath);
      cleanupPath = null;
      return {
        success: false,
        error: t('skillErrAlreadyInstalled', { name: duplicateSkillNameBeforeInstall }),
      };
    }

    const installedIds = installSkillDirsToRoot(skillDirs, root);

    ctx.persistSkillInstallState(installedIds, options);

    cleanupPathSafely(cleanupPath);
    cleanupPath = null;

    ctx.startWatching();
    ctx.notifySkillsChanged();
    return { success: true, skills: ctx.listSkills() };
  } catch (error) {
    cleanupPathSafely(cleanupPath);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to download skill',
    };
  }
}

function installSkillDirsToRoot(skillDirs: string[], root: string): string[] {
  const installedIds: string[] = [];
  for (const skillDir of skillDirs) {
    const folderName = normalizeFolderName(path.basename(skillDir));
    let targetDir = resolveWithin(root, folderName);
    let suffix = 1;
    while (fs.existsSync(targetDir)) {
      targetDir = resolveWithin(root, `${folderName}-${suffix}`);
      suffix += 1;
    }
    cpRecursiveSync(skillDir, targetDir);
    const normalizeResult = normalizeWindowsSkillDirectoryAttrs(targetDir);
    if (normalizeResult.success) {
      console.log('[skills] install normalization applied for "%s" at %s', folderName, targetDir);
    } else {
      console.warn(
        '[skills] install normalization failed for "%s" at %s: %s',
        folderName,
        targetDir,
        normalizeResult.detail || 'unknown',
      );
    }
    installedIds.push(path.basename(targetDir));
  }
  return installedIds;
}

export function confirmPendingInstallImpl(
  ctx: SkillManagerContext,
  pendingId: string,
  action: SecurityReportAction,
): { success: boolean; skills?: SkillRecord[]; error?: string } {
  console.log(`[SkillManager] confirmPendingInstall: id=${pendingId}, action=${action}`);
  const pending = ctx.pendingInstalls.get(pendingId);
  if (!pending) {
    console.warn(`[SkillManager] Pending install not found: ${pendingId}`);
    return { success: false, error: 'No pending install found' };
  }

  clearTimeout(pending.timer);
  ctx.pendingInstalls.delete(pendingId);

  if (action === 'cancel') {
    cleanupPathSafely(pending.cleanupPath);
    return { success: true };
  }

  if (!pending.isUpgrade) {
    const duplicateSkillName = findDuplicateSkillName(
      pending.skillDirs,
      ctx.listSkills().map(skill => skill.name),
    );
    if (duplicateSkillName) {
      cleanupPathSafely(pending.cleanupPath);
      return {
        success: false,
        error: t('skillErrAlreadyInstalled', { name: duplicateSkillName }),
      };
    }
  }

  // Install the skill(s)
  const installedIds: string[] = [];

  // Upgrade path: overwrite existing skill directory
  if (pending.isUpgrade && pending.existingSkillDir) {
    for (const skillDir of pending.skillDirs) {
      performSkillUpgrade(skillDir, pending.existingSkillDir);
      installedIds.push(path.basename(pending.existingSkillDir));
    }
  } else {
    // Fresh install path: find unique directory name
    installedIds.push(...installSkillDirsToRoot(pending.skillDirs, pending.root));
  }

  ctx.persistSkillInstallState(installedIds, pending);
  cleanupPathSafely(pending.cleanupPath);

  // If user chose 'installDisabled', disable all newly installed skills
  if (action === 'installDisabled') {
    for (const id of installedIds) {
      try {
        ctx.setSkillEnabled(id, false);
      } catch {
        // Non-critical
      }
    }
  }

  ctx.startWatching();
  ctx.notifySkillsChanged();
  return { success: true, skills: ctx.listSkills() };
}

export function performSkillUpgrade(newSkillDir: string, existingSkillDir: string): void {
  const upgradingDir = existingSkillDir + '.upgrading';

  // Back up .env and _meta.json
  let envBackup: Buffer | null = null;
  let metaBackup: Buffer | null = null;
  const envPath = path.join(existingSkillDir, '.env');
  const metaPath = path.join(existingSkillDir, '_meta.json');
  if (fs.existsSync(envPath)) {
    envBackup = fs.readFileSync(envPath);
  }
  if (fs.existsSync(metaPath)) {
    metaBackup = fs.readFileSync(metaPath);
  }

  // Atomic rename old dir to .upgrading backup
  fs.renameSync(existingSkillDir, upgradingDir);

  try {
    // Copy new version to original path
    cpRecursiveSync(newSkillDir, existingSkillDir);

    // Restore .env and _meta.json
    if (envBackup !== null) {
      fs.writeFileSync(path.join(existingSkillDir, '.env'), envBackup);
    }
    if (metaBackup !== null) {
      fs.writeFileSync(path.join(existingSkillDir, '_meta.json'), metaBackup);
    }
  } catch (error) {
    // Roll back: remove partial new dir and restore backup
    console.error('[SkillManager] upgrade copy failed, rolling back:', error);
    if (fs.existsSync(existingSkillDir)) {
      fs.rmSync(existingSkillDir, { recursive: true, force: true });
    }
    fs.renameSync(upgradingDir, existingSkillDir);
    throw error;
  }

  // Remove backup
  fs.rmSync(upgradingDir, { recursive: true, force: true });
}
