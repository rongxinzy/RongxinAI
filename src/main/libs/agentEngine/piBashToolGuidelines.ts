const WINDOWS_PLATFORM = 'win32';

/** Keep model-issued shell commands from holding a run open indefinitely. */
export const PI_BASH_DEFAULT_TIMEOUT_SECONDS = 5 * 60;
export const PI_BASH_MAX_TIMEOUT_SECONDS = 15 * 60;

const EXPLICIT_WINDOWS_SHELL = /(?:^|[\s;&|])(?:powershell(?:\.exe)?|pwsh|cmd(?:\.exe)?)(?:\s|$)/i;
const POWERSHELL_CMDLET =
  /(?:^|[\s;&|])(?:Get|Set|Remove|Copy|Move|New|Select|Write|Test)-[A-Za-z]+\b/;
const WINDOWS_DIR_SWITCH = /(?:^|[\s;&|])dir\b[^\n]*\/(?:s|b|a|o)(?:\s|$)/i;
const WINDOWS_BACKSLASH_PATH = /(?:^|[\s"'(])[A-Za-z]:\\[^\n]*/;

export const PiBashToolSystemPrompt = [
  '## Bash execution contract',
  '',
  '- The bash tool runs the configured Bash shell; on Windows this is bundled Git Bash, not cmd.exe or PowerShell.',
  '- Use POSIX shell syntax and commands such as ls, rg, find, sed, cp, and mv.',
  '- On Windows, write paths as C:/path or /c/path, use forward slashes, and quote paths containing spaces.',
  '- Do not use dir /s, PowerShell cmdlets, or unescaped C:\\ paths directly in Bash.',
  '- Invoke powershell.exe -NoProfile -Command explicitly when PowerShell syntax is required.',
].join('\n');

export const createPiBashToolSystemPrompt = (
  platform: NodeJS.Platform = process.platform,
): string =>
  platform === WINDOWS_PLATFORM
    ? `${PiBashToolSystemPrompt}\n- Bash commands have a ${PI_BASH_DEFAULT_TIMEOUT_SECONDS}-second default timeout; use a shorter timeout for bounded operations.`
    : `- Bash commands have a ${PI_BASH_DEFAULT_TIMEOUT_SECONDS}-second default timeout; use a shorter timeout for bounded operations.`;

/**
 * Normalize model-provided timeouts before Pi executes the command. Pi's
 * built-in Bash has no default timeout, so missing or invalid values must be
 * bounded by the runtime rather than trusting the model to provide one.
 */
export const normalizePiBashTimeoutSeconds = (timeout: unknown): number => {
  if (typeof timeout === 'number' && Number.isFinite(timeout) && timeout > 0) {
    return Math.min(timeout, PI_BASH_MAX_TIMEOUT_SECONDS);
  }
  return PI_BASH_DEFAULT_TIMEOUT_SECONDS;
};

/**
 * Return an actionable block reason for command dialects that are certainly
 * wrong for the configured Windows Git Bash shell. Deliberate cmd/PowerShell
 * invocations remain valid because they name their intended interpreter.
 */
export const getPiBashCommandViolation = (
  command: string,
  platform: NodeJS.Platform = process.platform,
): string | undefined => {
  if (platform !== WINDOWS_PLATFORM || EXPLICIT_WINDOWS_SHELL.test(command)) return undefined;

  if (POWERSHELL_CMDLET.test(command) || /\$env:[A-Za-z_][A-Za-z0-9_]*/.test(command)) {
    return 'This bash tool runs Git Bash on Windows. Use POSIX shell syntax, or invoke powershell.exe -NoProfile -Command explicitly for PowerShell commands.';
  }

  if (WINDOWS_DIR_SWITCH.test(command)) {
    return 'This bash tool runs Git Bash on Windows. Replace dir switches such as /s with POSIX commands, for example find . -type f.';
  }

  if (WINDOWS_BACKSLASH_PATH.test(command)) {
    return 'This bash tool runs Git Bash on Windows. Use C:/path or /c/path with forward slashes instead of a C:\\path argument.';
  }

  return undefined;
};
