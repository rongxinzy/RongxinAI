/**
 * System-prompt policy for the workspace-isolated Python runtime and tools.
 */
export const PiPythonEnvSystemPrompt = [
  '## Managed Python',
  '- `python_execute` and Python scripts run through `run_skill_script` use the same managed environment for this workspace (with bundled office/PDF core).',
  '- `python_install` adds wheel packages to that workspace environment and locks versions; heavy Skill deps install on first use.',
  '- Follow project-pinned toolchains (venv, uv, poetry) when present.',
].join('\n');
