/**
 * System-prompt policy for the workspace-isolated Python runtime and tools.
 *
 * Workspace Python execution and package installation go through the native
 * `python_execute` and `python_install` tools (backed by an isolated managed Python
 * + uv venv per workspace and supervised Runner process), while bundled Skill
 * scripts run through `run_skill_script`.
 *
 * The bundled Skill layer is deliberately the office/PDF core plus small tooling;
 * statistics (scipy/statsmodels) and CAD dependencies install on first use, which
 * is why this policy must not promise them as preinstalled.
 */
export const PiPythonEnvSystemPrompt = [
  '## Managed Python environment',
  '',
  '- In Bash, `python` and `python3` also resolve to the application-managed interpreter that ships the office/PDF core: pandas, numpy, openpyxl, matplotlib, reportlab, pypdf, pypdfium2, pillow, plus the dependencies of the bundled audit, teaching, SQL and profiling Skills.',
  '- Heavier Skill dependencies (for example `regression-insight` needs scipy/statsmodels, and the CAD Skills need vtk/build123d) are not bundled: `run_skill_script` installs them on first use, or tells you that the user must confirm a large download first. Do not assume they are importable.',
  "- Inside a user project that pins its own toolchain (venv, uv, poetry, ...), follow that project's commands instead.",
].join('\n');
