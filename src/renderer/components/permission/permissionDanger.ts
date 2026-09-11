import { i18nService } from '../../services/i18n';

export const PermissionDangerLevel = {
  Safe: 'safe',
  Caution: 'caution',
  Destructive: 'destructive',
} as const;
export type PermissionDangerLevel =
  (typeof PermissionDangerLevel)[keyof typeof PermissionDangerLevel];

export interface PermissionDanger {
  level: PermissionDangerLevel;
  reasonText: string;
}

const DESTRUCTIVE_COMMAND_PATTERNS = [
  /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f?|--recursive)\b/i,
  /\bgit\s+push\s+.*--force\b/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bdd\b/i,
  /\bmkfs\b/i,
] as const;

const CAUTION_COMMAND_PATTERNS = [
  /\b(rm|rmdir|unlink|del|erase|remove-item|trash)\b/i,
  /\bgit\s+push\b/i,
  /\b(kill|killall|pkill)\b/i,
  /\b(chmod|chown)\b/i,
  /\bgit\s+clean\b/i,
  /\bsudo\b/i,
] as const;

const DANGER_REASON_I18N_MAP: Record<string, string> = {
  'recursive-delete': 'dangerReasonRecursiveDelete',
  'git-force-push': 'dangerReasonGitForcePush',
  'git-reset-hard': 'dangerReasonGitResetHard',
  'disk-overwrite': 'dangerReasonDiskOverwrite',
  'disk-format': 'dangerReasonDiskFormat',
  'file-delete': 'dangerReasonFileDelete',
  'git-push': 'dangerReasonGitPush',
  'process-kill': 'dangerReasonProcessKill',
  'permission-change': 'dangerReasonPermissionChange',
};

const PERMISSION_DANGER_LEVELS: readonly PermissionDangerLevel[] =
  Object.values(PermissionDangerLevel);

const isPermissionDangerLevel = (value: unknown): value is PermissionDangerLevel =>
  typeof value === 'string' && PERMISSION_DANGER_LEVELS.includes(value as PermissionDangerLevel);

/** Fallback detection when the adapter does not provide a danger level. */
export const detectDangerLevelFromCommand = (command: string): PermissionDangerLevel => {
  if (DESTRUCTIVE_COMMAND_PATTERNS.some(pattern => pattern.test(command))) {
    return PermissionDangerLevel.Destructive;
  }
  if (CAUTION_COMMAND_PATTERNS.some(pattern => pattern.test(command))) {
    return PermissionDangerLevel.Caution;
  }
  return PermissionDangerLevel.Safe;
};

/**
 * Adapter-provided level and reason win; otherwise the command string is
 * scanned with the built-in patterns.
 */
export const detectPermissionDanger = (
  toolInput: Record<string, unknown> | null,
): PermissionDanger => {
  const command = typeof toolInput?.command === 'string' ? toolInput.command : '';
  const providedLevel = toolInput?.dangerLevel;
  const level = isPermissionDangerLevel(providedLevel)
    ? providedLevel
    : detectDangerLevelFromCommand(command);
  const reason = typeof toolInput?.dangerReason === 'string' ? toolInput.dangerReason : '';
  const i18nKey = DANGER_REASON_I18N_MAP[reason];
  return { level, reasonText: i18nKey ? i18nService.t(i18nKey) : '' };
};

export const PermissionDangerSafe: PermissionDanger = {
  level: PermissionDangerLevel.Safe,
  reasonText: '',
};
