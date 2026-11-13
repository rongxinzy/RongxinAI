const PYTHON_INVOCATION = /(?:^|[;&|(\s"'])python3?(?:\.exe)?["']?\s/i;
const SKILLS_ROOT_VARIABLE = /\$(?:env:)?\{?SKILLS_ROOT\}?/i;

const normalizePathSeparators = (value: string): string => value.replace(/\\/g, '/').toLowerCase();

/**
 * Redirect direct shell invocations of bundled Skill scripts to the
 * run_skill_script tool so the per-Skill dependency gate applies.
 * Workspace Python execution and package installation use python_execute
 * and python_install, so shell tools no longer intercept pip/uv commands.
 *
 * Work-package G re-evaluation (2026-10): KEEP this gate. It is narrow —
 * only a `python`/`python3` invocation referencing the Skills root is
 * blocked — and it protects a real failure mode, not a style rule: bundled
 * Skill scripts depend on the shared dependency layer (office/PDF core; heavier
 * Skill dependencies install on demand into a per-Skill overlay) and the
 * run_skill_script harness (requirements manifest gate, timeouts, output
 * caps); a bare-shell invocation burns a turn on missing-dependency errors
 * after the fact. General shell python stays untouched.
 */
export const getPiBashPythonEnvViolation = (
  command: string,
  skillsRoot?: string,
): string | undefined => {
  if (PYTHON_INVOCATION.test(command)) {
    const referencesSkillsRoot =
      SKILLS_ROOT_VARIABLE.test(command) ||
      Boolean(
        skillsRoot &&
        normalizePathSeparators(command).includes(normalizePathSeparators(skillsRoot)),
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
