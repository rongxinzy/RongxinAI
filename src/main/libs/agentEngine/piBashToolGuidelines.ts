const WINDOWS_PLATFORM = 'win32';

/** Keep model-issued shell commands from holding a run open indefinitely. */
export const PI_BASH_DEFAULT_TIMEOUT_SECONDS = 5 * 60;
export const PI_BASH_MAX_TIMEOUT_SECONDS = 15 * 60;

const EXPLICIT_WINDOWS_SHELL = /(?:^|[\s;&|])(?:powershell(?:\.exe)?|pwsh|cmd(?:\.exe)?)(?:\s|$)/i;
const POWERSHELL_CMDLET =
  /(?:^|[\s;&|])(?:Get|Set|Remove|Copy|Move|New|Select|Write|Test)-[A-Za-z]+\b/;
const WINDOWS_DIR_SWITCH = /(?:^|[\s;&|])dir\b[^\n]*\/(?:s|b|a|o)(?:\s|$)/i;
const WINDOWS_BACKSLASH_PATH = /(?:^|[\s"'(])[A-Za-z]:\\[^\n]*/;

// A pip command at a command position (start or after a shell separator);
// path-qualified invocations like .venv/bin/pip are deliberately not matched.
const PIP_INSTALL_COMMAND = /(?:^|[;&|(\s])pip3?(?:\.(?:exe|cmd|bat))?\s+[^\n;&|]*\binstall\b/;
const PYTHON_PIP_MODULE =
  /(?:^|[;&|(\s])python3?(?:\.exe)?\s+(?:-{1,2}[\w.-]+\s+)*-m\s+pip\s+[^\n;&|]*\binstall\b/;
// Commands that explicitly operate on a project-local environment are exempt:
// installing into the user's own venv or uv project is legitimate toolchain use.
const PROJECT_ENV_CONTEXT =
  /(?:[\\/]\.?venv[\\/]|activate|VIRTUAL_ENV=|pyproject\.toml|uv\s+(?:add|sync|lock))/;
const PYTHON_INVOCATION = /(?:^|[;&|(\s])python3?(?:\.exe)?\s/;
const SKILLS_ROOT_VARIABLE = /\$\{?SKILLS_ROOT\}?/;

export const PiBashToolSystemPrompt = [
  '## Bash execution contract',
  '',
  '- The bash tool runs the configured Bash shell; on Windows this is bundled Git Bash, not cmd.exe or PowerShell.',
  '- Use POSIX shell syntax and commands such as ls, rg, find, sed, cp, and mv.',
  '- On Windows, write paths as C:/path or /c/path, use forward slashes, and quote paths containing spaces.',
  '- Do not use dir /s, PowerShell cmdlets, or unescaped C:\\ paths directly in Bash.',
  '- Invoke powershell.exe -NoProfile -Command explicitly when PowerShell syntax is required.',
].join('\n');

const BASH_TIMEOUT_POLICY = `- Bash commands have a ${PI_BASH_DEFAULT_TIMEOUT_SECONDS}-second default timeout and a ${PI_BASH_MAX_TIMEOUT_SECONDS}-second maximum; requests above the maximum are clamped to ${PI_BASH_MAX_TIMEOUT_SECONDS} seconds, and a command killed at the limit reports the effective timeout.`;

export const createPiBashToolSystemPrompt = (
  platform: NodeJS.Platform = process.platform,
): string =>
  platform === WINDOWS_PLATFORM
    ? `${PiBashToolSystemPrompt}\n${BASH_TIMEOUT_POLICY}`
    : BASH_TIMEOUT_POLICY;

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
 * Block model-issued shell commands that would damage or bypass the managed
 * Python environment. `pip install` resolves to the bare base runtime's pip,
 * so the packages never appear for the interpreter the agent actually runs;
 * bundled Skill scripts must go through run_skill_script so the per-Skill
 * dependency gate applies. Matches the policy in PiPythonEnvSystemPrompt.
 */
export const getPiBashPythonEnvViolation = (
  command: string,
  skillsRoot?: string,
): string | undefined => {
  if (
    (PIP_INSTALL_COMMAND.test(command) || PYTHON_PIP_MODULE.test(command)) &&
    !PROJECT_ENV_CONTEXT.test(command)
  ) {
    return (
      'The managed Python environment is fixed and already carries the bundled libraries. ' +
      'Do not pip install into it: for a missing library use run_skill_script, and inside a ' +
      "user project use the project's own toolchain (its venv pip, uv add/uv sync) instead of the global pip."
    );
  }

  if (PYTHON_INVOCATION.test(command)) {
    const referencesSkillsRoot =
      SKILLS_ROOT_VARIABLE.test(command) ||
      Boolean(
        skillsRoot && command.toLowerCase().includes(skillsRoot.replace(/\\/g, '/').toLowerCase()),
      );
    if (referencesSkillsRoot) {
      return (
        'Bundled Skill scripts must run through the run_skill_script tool so the managed ' +
        'runtime and the Skill dependency set are used; do not invoke them with python/python3.'
      );
    }
  }

  return undefined;
};

/**
 * Return an actionable block reason for command dialects that are certainly
 * wrong for the configured Windows Git Bash shell. Deliberate cmd/PowerShell
 * invocations remain valid because they name their intended interpreter.
 * Python environment violations are evaluated first on every platform.
 */
export const getPiBashCommandViolation = (
  command: string,
  platform: NodeJS.Platform = process.platform,
  skillsRoot?: string,
): string | undefined => {
  const pythonEnvViolation = getPiBashPythonEnvViolation(command, skillsRoot);
  if (pythonEnvViolation) return pythonEnvViolation;

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
