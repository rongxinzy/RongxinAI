/**
 * System-prompt policy for the workspace-isolated Python runtime and tools.
 *
 * Workspace Python execution and package installation go through the native
 * `python_execute` and `python_install` tools. The bundled office/PDF core is
 * available to workspace code, while additional packages stay workspace-local.
 * Bundled Skill scripts run through `run_skill_script`.
 *
 * The bundled Skill layer is deliberately the office/PDF core plus small tooling;
 * statistics (scipy/statsmodels) and CAD dependencies install on first use, which
 * is why this policy must not promise them as preinstalled.
 */
export const PiPythonEnvSystemPrompt = [
  '## Managed Python environment',
  '',
  '- `python_execute` and Python scripts run through `run_skill_script` use the same managed environment for this workspace, with the bundled office/PDF core available.',
  '- `python_install` adds wheel packages to that workspace environment; package names or version constraints are accepted and resolved versions are locked.',
  '- `run_skill_script` checks declared Skill dependencies. Heavier dependencies are installed on first use and may require confirmation for a large download.',
  "- Inside a user project that pins its own toolchain (venv, uv, poetry, ...), follow that project's commands instead.",
].join('\n');
