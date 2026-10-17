import crypto from 'crypto';
import { app } from 'electron';
import fs from 'fs';
import path from 'path';

import { cpRecursiveSync } from '../fsCompat';
import { t } from '../i18n';
import { mergeReports, scanMultipleSkillDirs } from '../libs/skillSecurity/skillSecurityScanner';
import type { SkillSecurityReport } from '../libs/skillSecurity/skillSecurityTypes';
import { SKILL_FILE_NAME } from './constants';
import { downloadGithubArchive, downloadZipUrl, isRemoteZipUrl } from './downloadUtils';
import {
  deriveRepoName,
  normalizeGitSource,
  parseGithubRepoSource,
  resolveGitCommand,
} from './gitUtils';
import { resolveMarketplaceSkillSource } from './marketplaceSource';
import { performSkillUpgrade } from './skillInstaller';
import { collectSkillDirsFromSource } from './skillDirs';
import { normalizeFolderName, resolveWithin } from './skillMarkdown';
import type { SkillManagerContext, SkillRecord } from './types';
import { cleanupPathSafely } from './windowsFs';
import { runCommand, runCommandCapture } from './processRunner';

export async function upgradeSkillImpl(
  ctx: SkillManagerContext,
  skillId: string,
  downloadUrl: string,
): Promise<{
  success: boolean;
  skills?: SkillRecord[];
  error?: string;
  auditReport?: SkillSecurityReport;
  pendingInstallId?: string;
}> {
  // Prevent concurrent upgrades of the same skill
  if (ctx.upgradingSkillIds.has(skillId)) {
    return { success: false, error: `Skill "${skillId}" is already being upgraded` };
  }

  // Find the installed skill
  const installedSkills = ctx.listSkills();
  const installed = installedSkills.find(s => s.id === skillId);
  if (!installed) {
    return { success: false, error: `Skill "${skillId}" is not installed` };
  }

  const existingSkillDir = path.dirname(installed.skillPath);
  if (!fs.existsSync(existingSkillDir)) {
    return { success: false, error: `Skill directory not found: ${existingSkillDir}` };
  }

  ctx.upgradingSkillIds.add(skillId);
  try {
    return await performUpgradeDownload(ctx, skillId, downloadUrl, existingSkillDir);
  } finally {
    ctx.upgradingSkillIds.delete(skillId);
  }
}

async function performUpgradeDownload(
  ctx: SkillManagerContext,
  skillId: string,
  downloadUrl: string,
  existingSkillDir: string,
): Promise<{
  success: boolean;
  skills?: SkillRecord[];
  error?: string;
  auditReport?: SkillSecurityReport;
  pendingInstallId?: string;
}> {
  let cleanupPath: string | null = null;
  try {
    const resolvedDownloadUrl = await resolveMarketplaceSkillSource(downloadUrl);
    if (!resolvedDownloadUrl) {
      return { success: false, error: t('skillErrModelScopeInstallUnavailable') };
    }

    console.log(
      `[SkillManager] starting upgrade for skill "${skillId}" via "${resolvedDownloadUrl}"`,
    );
    const root = ctx.ensureSkillsRoot();

    // Download new version (reuse downloadSkill's download logic)
    const tempRoot = fs.mkdtempSync(path.join(app.getPath('temp'), 'zhiyuan-skill-upgrade-'));
    cleanupPath = tempRoot;

    let localSource: string;
    if (isRemoteZipUrl(resolvedDownloadUrl)) {
      localSource = await downloadZipUrl(resolvedDownloadUrl, tempRoot);
    } else {
      const normalized = normalizeGitSource(resolvedDownloadUrl);
      if (!normalized) {
        cleanupPathSafely(cleanupPath);
        return { success: false, error: 'Invalid download URL' };
      }
      const repoName = normalizeFolderName(
        normalized.repoNameHint || deriveRepoName(normalized.repoUrl),
      );
      const clonePath = path.join(tempRoot, repoName);
      const githubSource = parseGithubRepoSource(normalized.repoUrl);
      let downloadedSourceRoot = clonePath;
      let downloaded = false;

      if (githubSource) {
        try {
          downloadedSourceRoot = await downloadGithubArchive(
            githubSource,
            tempRoot,
            normalized.ref,
          );
          downloaded = true;
        } catch {
          // Fall through to git clone
        }
      }

      if (!downloaded) {
        const gitRuntime = resolveGitCommand();
        // For upgrades, prefer the installed skill's git remote URL over the
        // marketplace URL. The installed repo's .git/config already points at
        // the correct remote that git can fetch from directly.

        let cloneUrl = normalized.repoUrl;
        if (fs.existsSync(path.join(existingSkillDir, '.git'))) {
          try {
            const { stdout } = await runCommandCapture(
              gitRuntime.command,
              ['remote', 'get-url', 'origin'],
              {
                cwd: existingSkillDir,
                env: gitRuntime.env,
              },
            );
            const remoteUrl = stdout.trim();
            if (remoteUrl) {
              cloneUrl = remoteUrl;
            }
          } catch {
            // Keep the original URL as fallback
          }
        }

        try {
          const cloneArgs = ['clone', '--depth', '1'];
          if (normalized.ref) cloneArgs.push('--branch', normalized.ref);
          cloneArgs.push(cloneUrl, clonePath);
          await runCommand(gitRuntime.command, cloneArgs, { env: gitRuntime.env });
        } catch (cloneErr: unknown) {
          const cloneMsg = cloneErr instanceof Error ? cloneErr.message : String(cloneErr);
          // If clone fails with a redirect error, fall back to fetching inside the
          // existing repo — its on-disk remote URL may survive a redirect that a
          // fresh clone cannot handle.
          if (
            /unable to update url base from redirection/i.test(cloneMsg) ||
            /redirect/i.test(cloneMsg)
          ) {
            console.log(
              `[SkillManager] clone redirect fallback, fetching in existing repo for "${skillId}"`,
            );
            const fetchArgs = ['fetch', '--depth', '1', 'origin'];
            if (normalized.ref) fetchArgs.push(normalized.ref);
            await runCommand(gitRuntime.command, fetchArgs, {
              cwd: existingSkillDir,
              env: gitRuntime.env,
            });
            await runCommand(gitRuntime.command, ['checkout', 'FETCH_HEAD'], {
              cwd: existingSkillDir,
              env: gitRuntime.env,
            });
            // Copy the updated existing dir to the temp clone path so the rest
            // of the upgrade flow (security scan, atomic replace) works unchanged.
            cpRecursiveSync(existingSkillDir, clonePath);
          } else {
            throw cloneErr;
          }
        }
      }

      if (normalized.sourceSubpath) {
        const scopedSource = resolveWithin(downloadedSourceRoot, normalized.sourceSubpath);
        if (!fs.existsSync(scopedSource)) {
          cleanupPathSafely(cleanupPath);
          return { success: false, error: `Path "${normalized.sourceSubpath}" not found` };
        }
        localSource =
          fs.statSync(scopedSource).isFile() && path.basename(scopedSource) === SKILL_FILE_NAME
            ? path.dirname(scopedSource)
            : scopedSource;
      } else {
        localSource = downloadedSourceRoot;
      }
    }

    const skillDirs = collectSkillDirsFromSource(localSource);
    if (skillDirs.length === 0) {
      cleanupPathSafely(cleanupPath);
      return { success: false, error: t('skillErrNoSkillMd') };
    }

    // Find the matching skill dir for this ID
    const matchingSkillDir =
      skillDirs.find(d => normalizeFolderName(path.basename(d)) === skillId) || skillDirs[0];

    // Security scan
    let auditReport: SkillSecurityReport | null = null;
    try {
      const reports = await scanMultipleSkillDirs([matchingSkillDir]);
      auditReport = mergeReports(reports);
    } catch (err) {
      console.warn('[SkillManager] Security scan failed (non-blocking):', err);
    }

    // If risk detected, cache for user confirmation
    if (auditReport && auditReport.riskLevel !== 'safe') {
      const pendingId = crypto.randomUUID();
      console.log(
        `[SkillManager] Upgrade risk detected (${auditReport.riskLevel}), pending confirmation: ${pendingId}`,
      );
      const timer = setTimeout(
        () => {
          const pending = ctx.pendingInstalls.get(pendingId);
          if (pending) {
            cleanupPathSafely(pending.cleanupPath);
            ctx.pendingInstalls.delete(pendingId);
          }
        },
        5 * 60 * 1000,
      );

      ctx.pendingInstalls.set(pendingId, {
        tempDir: localSource,
        cleanupPath,
        root,
        skillDirs: [matchingSkillDir],
        timer,
        isUpgrade: true,
        existingSkillDir,
      });

      // Ownership of cleanupPath transferred to pendingInstalls
      cleanupPath = null;
      return { success: true, auditReport, pendingInstallId: pendingId };
    }

    // Safe — perform upgrade
    performSkillUpgrade(matchingSkillDir, existingSkillDir);

    cleanupPathSafely(cleanupPath);
    cleanupPath = null;

    ctx.startWatching();
    ctx.notifySkillsChanged();
    return { success: true, skills: ctx.listSkills() };
  } catch (error) {
    cleanupPathSafely(cleanupPath);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to upgrade skill',
    };
  }
}
