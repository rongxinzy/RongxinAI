/**
 * System-prompt policy for the workspace-isolated Python runtime and tools.
 *
 * Workspace Python execution and package installation go through the native
 * `python_execute` and `python_install` tools (backed by an isolated Python 3.12
 * + uv venv per workspace and supervised Runner process), while bundled Skill
 * scripts run through `run_skill_script`.
 */
export const PiPythonEnvSystemPrompt = [
  '## Managed Python environment',
  '',
  '- Prefer `python_execute` to run Python code in the current workspace using its isolated Python 3.12 environment, and `python_install` to atomically install exact pinned PyPI wheel packages (such as `numpy==2.2.6`) into this workspace.',
  "- In Bash, `python` and `python3` also resolve to the application-managed interpreter with pandas, numpy, openpyxl, matplotlib, and bundled Skills' dependencies preinstalled.",
  "- Inside a user project that pins its own toolchain (venv, uv, poetry, ...), follow that project's commands instead.",
  '- Bundled Skill scripts run through the `run_skill_script` tool; never invoke them with `python`/`python3` on a Skills directory path.',
].join('\n');
