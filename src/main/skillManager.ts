import { app } from 'electron';
import fs from 'fs';
import path from 'path';

import { isCoreSkill } from '../shared/skills/constants';
import { createModelScopeTokenPool, ModelScopeStoreKey } from './libs/modelscopeTokenPool';
import { SqliteStore } from './sqliteStore';
import { skillRootRegistry } from './skillRootRegistry';
import { recoverInterruptedUpgrades, syncBundledSkillsToUserData } from './skills/bundledSync';
import { testEmailConnectivityImpl } from './skills/emailConnectivity';
import {
  getSkillConfigFromDir,
  ensureSkillDirDependencies,
  setSkillConfigToDir,
} from './skills/skillConfig';
import { confirmPendingInstallImpl, downloadSkillImpl } from './skills/skillInstaller';
import { deleteSkillImpl } from './skills/skillDeleter';
import { upgradeSkillImpl } from './skills/skillUpgrader';
import { collectBuiltInSkillIds, loadSkillsDefaults, parseSkillDir } from './skills/skillRecords';
import { SKILLS_DIR_NAME, SKILL_FILE_NAME, SKILL_STATE_KEY } from './skills/constants';
import { listSkillDirs } from './skills/skillDirs';
import { SkillWatcher } from './skills/skillWatcher';
import type {
  SecurityReportAction,
  SkillSecurityReport,
} from './libs/skillSecurity/skillSecurityTypes';
import type {
  EmailConnectivityTestResult,
  PendingSkillInstall,
  SkillInstallOptions,
  SkillManagerContext,
  SkillRecord,
  SkillStateMap,
} from './skills/types';
import {
  extractDescription,
  findDuplicateSkillName,
  hasMatchingBundledRequirements,
  isTruthy,
  normalizeSkillName,
  parseFrontmatter,
  resolveWithin,
} from './skills/skillMarkdown';
import { isWindowsDeletePermissionError } from './skills/windowsFs';

export type { SkillRecord } from './skills/types';

export class SkillManager implements SkillManagerContext {
  readonly pendingInstalls = new Map<string, PendingSkillInstall>();
  readonly upgradingSkillIds = new Set<string>();
  readonly deletingSkillIds = new Set<string>();
  private readonly watcher: SkillWatcher;

  constructor(private getStore: () => SqliteStore) {
    this.watcher = new SkillWatcher(() => this.getSkillRoots(this.ensureSkillsRoot()));
  }

  private getModelScopeApiToken(): string | null {
    const userToken = this.getStore().get<string>(ModelScopeStoreKey.ApiToken);
    return createModelScopeTokenPool({
      extraTokens: userToken ? [userToken] : [],
    }).nextToken();
  }

  getSkillsRoot(): string {
    const projectRoot = path.resolve(__dirname, '..');
    const projectSkillsRoot = path.resolve(projectRoot, SKILLS_DIR_NAME);
    if (!app.isPackaged && fs.existsSync(projectSkillsRoot)) {
      return projectSkillsRoot;
    }
    return path.resolve(app.getPath('userData'), SKILLS_DIR_NAME);
  }

  ensureSkillsRoot(): string {
    const root = this.getSkillsRoot();
    if (!fs.existsSync(root)) {
      fs.mkdirSync(root, { recursive: true });
    }
    return root;
  }

  recoverInterruptedUpgrades(): void {
    recoverInterruptedUpgrades(this.getSkillsRoot());
  }

  syncBundledSkillsToUserData(): void {
    if (!app.isPackaged) {
      return;
    }

    syncBundledSkillsToUserData(this.ensureSkillsRoot(), this.getBundledSkillsRoot());
  }

  listSkills(): SkillRecord[] {
    const primaryRoot = this.ensureSkillsRoot();
    const state = this.loadSkillStateMap();
    const roots = this.getSkillRoots(primaryRoot);
    const orderedRoots = roots.filter(root => root !== primaryRoot).concat(primaryRoot);
    const defaults = loadSkillsDefaults(roots);
    const builtInSkillIds = collectBuiltInSkillIds(this.getBundledSkillsRoot());
    const skillMap = new Map<string, SkillRecord>();

    orderedRoots.forEach(root => {
      if (!fs.existsSync(root)) return;
      const skillDirs = listSkillDirs(root);
      skillDirs.forEach(dir => {
        const skill = parseSkillDir(
          dir,
          state,
          defaults,
          builtInSkillIds.has(path.basename(dir)) &&
            !state[path.basename(dir)]?.userInstalled &&
            !state[path.basename(dir)]?.iconUrl,
        );
        if (!skill) return;
        skillMap.set(skill.id, skill);
      });
    });

    const skills = Array.from(skillMap.values());

    skills.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      const orderA = defaults[a.id]?.order ?? 999;
      const orderB = defaults[b.id]?.order ?? 999;
      if (orderA !== orderB) return orderA - orderB;
      return a.name.localeCompare(b.name);
    });
    return skills;
  }

  buildAutoRoutingPrompt(): string | null {
    const skills = this.listSkills();
    const enabled = skills.filter(s => s.enabled && s.prompt);
    if (enabled.length === 0) return null;

    const skillEntries = enabled
      .map(
        s =>
          `  <skill><id>${s.id}</id><name>${s.name}</name><description>${s.description}</description><location>${s.skillPath}</location></skill>`,
      )
      .join('\n');

    return [
      '## Skills (mandatory)',
      'Before replying: scan <available_skills> <description> entries.',
      '- If exactly one skill clearly applies: read its SKILL.md at <location> with the Read tool, then follow it.',
      '- If multiple could apply: choose the most specific one, then read/follow it.',
      '- If none clearly apply: do not read any SKILL.md.',
      '- IMPORTANT: If a description contains "Do NOT use" constraints, strictly respect them. If the user\'s request falls into a "Do NOT" category, treat that skill as non-matching — do NOT read its SKILL.md.',
      '- For the selected skill, treat <location> as the canonical SKILL.md path.',
      '- Resolve relative paths mentioned by that SKILL.md against its directory (dirname(<location>)), not the workspace root.',
      'Constraints: never read more than one skill up front; only read additional skills if the first one explicitly references them.',
      '',
      '<available_skills>',
      skillEntries,
      '</available_skills>',
    ].join('\n');
  }

  setSkillEnabled(id: string, enabled: boolean): SkillRecord[] {
    // Core skills cannot be disabled; ignore attempts to turn them off.
    if (isCoreSkill(id) && !enabled) {
      return this.listSkills();
    }
    const state = this.loadSkillStateMap();
    state[id] = { ...state[id], enabled };
    this.saveSkillStateMap(state);
    this.notifySkillsChanged();
    return this.listSkills();
  }

  setSkillsEnabled(ids: string[], enabled: boolean): SkillRecord[] {
    const state = this.loadSkillStateMap();
    const uniqueIds = [...new Set(ids)];
    for (const id of uniqueIds) {
      // Core skills cannot be disabled; skip them on disable batches.
      if (!enabled && isCoreSkill(id)) continue;
      state[id] = { ...state[id], enabled };
    }
    this.saveSkillStateMap(state);
    this.notifySkillsChanged();
    return this.listSkills();
  }

  async getSkillContent(id: string): Promise<{
    success: boolean;
    content?: string;
    error?: string;
  }> {
    try {
      if (id !== path.basename(id)) return { success: false, error: 'Skill not found' };
      const skillPath = this.getSkillRoots(this.ensureSkillsRoot())
        .map(root => resolveWithin(root, id))
        .map(dir => path.join(dir, SKILL_FILE_NAME))
        .find(filePath => fs.existsSync(filePath));
      if (!skillPath) return { success: false, error: 'Skill not found' };
      const raw = await fs.promises.readFile(skillPath, 'utf8');
      return { success: true, content: parseFrontmatter(raw).content.trim() };
    } catch (error) {
      console.error('[skills] Failed to read skill content:', error);
      return { success: false, error: 'Failed to read skill content' };
    }
  }

  setSkillPinned(id: string, pinned: boolean): SkillRecord[] {
    const state = this.loadSkillStateMap();
    state[id] = { ...state[id], enabled: state[id]?.enabled ?? true, pinned };
    this.saveSkillStateMap(state);
    this.notifySkillsChanged();
    return this.listSkills();
  }

  async deleteSkill(id: string): Promise<SkillRecord[]> {
    return deleteSkillImpl(this, id);
  }

  async downloadSkill(
    source: string,
    options: SkillInstallOptions = {},
  ): Promise<{
    success: boolean;
    skills?: SkillRecord[];
    error?: string;
    auditReport?: SkillSecurityReport;
    pendingInstallId?: string;
  }> {
    return downloadSkillImpl(this, source, options);
  }

  async upgradeSkill(
    skillId: string,
    downloadUrl: string,
  ): Promise<{
    success: boolean;
    skills?: SkillRecord[];
    error?: string;
    auditReport?: SkillSecurityReport;
    pendingInstallId?: string;
  }> {
    return upgradeSkillImpl(this, skillId, downloadUrl);
  }

  confirmPendingInstall(
    pendingId: string,
    action: SecurityReportAction,
  ): { success: boolean; skills?: SkillRecord[]; error?: string } {
    return confirmPendingInstallImpl(this, pendingId, action);
  }

  startWatching(): void {
    this.watcher.startWatching();
  }

  stopWatching(): void {
    this.watcher.stopWatching();
  }

  handleWorkingDirectoryChange(): void {
    this.watcher.handleWorkingDirectoryChange();
  }

  notifySkillsChanged(): void {
    this.watcher.notifySkillsChanged();
  }

  onSkillsChanged(listener: () => void): () => void {
    return this.watcher.onSkillsChanged(listener);
  }

  isBuiltInSkillId(id: string): boolean {
    if (!collectBuiltInSkillIds(this.getBundledSkillsRoot()).has(id)) return false;
    const state = this.loadSkillStateMap();
    return !state[id]?.userInstalled && !state[id]?.iconUrl;
  }

  loadSkillStateMap(): SkillStateMap {
    const store = this.getStore();
    const raw = store.get(SKILL_STATE_KEY) as SkillStateMap | SkillRecord[] | undefined;
    if (Array.isArray(raw)) {
      const migrated: SkillStateMap = {};
      raw.forEach(skill => {
        migrated[skill.id] = { enabled: skill.enabled };
      });
      store.set(SKILL_STATE_KEY, migrated);
      return migrated;
    }
    return raw ?? {};
  }

  saveSkillStateMap(map: SkillStateMap): void {
    this.getStore().set(SKILL_STATE_KEY, map);
  }

  persistSkillInstallState(
    ids: string[],
    options: { iconUrl?: string; displayName?: string },
  ): void {
    const normalizedIconUrl = options.iconUrl?.trim();
    const normalizedDisplayName = options.displayName?.trim();
    const state = this.loadSkillStateMap();
    for (const id of ids) {
      state[id] = {
        ...state[id],
        enabled: state[id]?.enabled ?? true,
        userInstalled: true,
        ...(normalizedIconUrl ? { iconUrl: normalizedIconUrl } : {}),
        ...(normalizedDisplayName ? { displayName: normalizedDisplayName } : {}),
      };
    }
    this.saveSkillStateMap(state);
  }

  getSkillRoots(primaryRoot?: string): string[] {
    const resolvedPrimary = primaryRoot ?? this.getSkillsRoot();
    const roots: string[] = [resolvedPrimary];

    const appRoot = this.getBundledSkillsRoot();
    if (appRoot !== resolvedPrimary && fs.existsSync(appRoot)) {
      roots.push(appRoot);
    }
    return skillRootRegistry.appendTo(roots);
  }

  getBundledSkillsRoot(): string {
    if (app.isPackaged) {
      const resourcesRoot = path.resolve(process.resourcesPath, SKILLS_DIR_NAME);
      if (fs.existsSync(resourcesRoot)) {
        return resourcesRoot;
      }

      return path.resolve(app.getAppPath(), SKILLS_DIR_NAME);
    }

    // __dirname is dist-electron/, so we need to go up one level to get to project root
    const projectRoot = path.resolve(__dirname, '..');
    return path.resolve(projectRoot, SKILLS_DIR_NAME);
  }

  getSkillConfig(skillId: string): {
    success: boolean;
    config?: Record<string, string>;
    error?: string;
  } {
    try {
      return getSkillConfigFromDir(this.resolveSkillDir(skillId));
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to read skill config',
      };
    }
  }

  setSkillConfig(
    skillId: string,
    config: Record<string, string>,
  ): { success: boolean; error?: string } {
    try {
      return setSkillConfigToDir(this.resolveSkillDir(skillId), config);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to write skill config',
      };
    }
  }

  ensureSkillDependencies(skillDir: string): { success: boolean; error?: string } {
    return ensureSkillDirDependencies(skillDir, this.getBundledSkillsRoot());
  }

  async testEmailConnectivity(
    skillId: string,
    config: Record<string, string>,
  ): Promise<{ success: boolean; result?: EmailConnectivityTestResult; error?: string }> {
    return testEmailConnectivityImpl(this, skillId, config);
  }

  resolveSkillDir(skillId: string): string {
    const skills = this.listSkills();
    const skill = skills.find(s => s.id === skillId);
    if (!skill) {
      throw new Error('Skill not found');
    }
    return path.dirname(skill.skillPath);
  }
}

export const __skillManagerTestUtils = {
  parseFrontmatter,
  isTruthy,
  extractDescription,
  normalizeSkillName,
  findDuplicateSkillName,
  isWindowsDeletePermissionError,
  hasMatchingBundledRequirements,
};
