export type SkillRecord = {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  pinned: boolean;
  isOfficial: boolean;
  isBuiltIn: boolean;
  updatedAt: number;
  prompt: string;
  skillPath: string;
  iconUrl?: string;
  displayName?: string;
  displayDescription?: string;
  displayAuthor?: string;
  displayLicense?: string;
  metadataContent?: string;
  metadataFields?: Record<string, string>;
  version?: string;
};

export type SkillStateMap = Record<
  string,
  {
    enabled: boolean;
    pinned?: boolean;
    iconUrl?: string;
    displayName?: string;
    userInstalled?: boolean;
  }
>;

export type SkillInstallOptions = {
  iconUrl?: string;
  displayName?: string;
};

export type EmailConnectivityCheckCode = 'imap_connection' | 'smtp_connection';
type EmailConnectivityCheckLevel = 'pass' | 'fail';
export type EmailConnectivityVerdict = 'pass' | 'fail';

export type EmailConnectivityCheck = {
  code: EmailConnectivityCheckCode;
  level: EmailConnectivityCheckLevel;
  message: string;
  durationMs: number;
};

export type EmailConnectivityTestResult = {
  testedAt: number;
  verdict: EmailConnectivityVerdict;
  checks: EmailConnectivityCheck[];
};

export type SkillDefaultConfig = {
  order?: number;
  enabled?: boolean;
  displayName?: string;
};

export type SkillsConfig = {
  version: number;
  description?: string;
  defaults: Record<string, SkillDefaultConfig>;
  /** Bundled skill IDs deliberately removed from the product. */
  retired?: string[];
};

export type SkillScriptRunResult = {
  success: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  error?: string;
  spawnErrorCode?: string;
};

/** A skill install parked until the user confirms a security report. */
export type PendingSkillInstall = {
  tempDir: string;
  cleanupPath: string | null;
  root: string;
  skillDirs: string[];
  timer: NodeJS.Timeout;
  isUpgrade?: boolean;
  existingSkillDir?: string;
  iconUrl?: string;
  displayName?: string;
};

/**
 * The slice of {@link SkillManager} that install/upgrade/delete flows need.
 * Kept as an interface so the extracted modules stay decoupled from the
 * manager class (no import cycles).
 */
export interface SkillManagerContext {
  readonly pendingInstalls: Map<string, PendingSkillInstall>;
  readonly upgradingSkillIds: Set<string>;
  readonly deletingSkillIds: Set<string>;
  ensureSkillsRoot(): string;
  getBundledSkillsRoot(): string;
  listSkills(): SkillRecord[];
  isBuiltInSkillId(id: string): boolean;
  loadSkillStateMap(): SkillStateMap;
  saveSkillStateMap(map: SkillStateMap): void;
  persistSkillInstallState(ids: string[], options: SkillInstallOptions): void;
  setSkillEnabled(id: string, enabled: boolean): SkillRecord[];
  notifySkillsChanged(): void;
  startWatching(): void;
  stopWatching(): void;
  resolveSkillDir(skillId: string): string;
  ensureSkillDependencies(skillDir: string): { success: boolean; error?: string };
}
