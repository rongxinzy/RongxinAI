/**
 * System-prompt policy for the application-managed Python environment.
 *
 * The agent shell exposes several interpreters (shared dependency layer,
 * bare base runtime, ephemeral uv environments); models trained on generic
 * setups habitually pip-install, create venvs, or `uv run`, all of which
 * lose the preinstalled Skill dependencies. This policy is registered in
 * piSystemPromptContributions so it survives user system-prompt overrides,
 * and is enforced mechanically by the bash command violations in
 * piBashToolGuidelines.
 */
export const PiPythonEnvSystemPrompt = [
  '## Managed Python environment',
  '',
  "- `python` and `python3` resolve to the same managed interpreter with pandas, numpy, openpyxl, matplotlib, and the bundled Skills' dependencies preinstalled. Import them directly; do not probe for or switch to another environment first.",
  '- Never repair or rebuild the managed environment: `pip`/`pip3 install` and `python -m pip` target the wrong interpreter, `uv run`/`uv pip` resolve a bare base interpreter without the preinstalled packages, and a fresh venv hides them. `uv` is reserved for application-internal use.',
  "- Inside a user project that pins its own toolchain (venv, uv, poetry, ...), follow that project's commands instead.",
  '- Bundled Skill scripts run through the `run_skill_script` tool; never invoke them with `python`/`python3` on a Skills directory path.',
  "- When an import fails, switch to `run_skill_script` (it resolves that Skill's requirements automatically) or report the missing library to the user.",
].join('\n');
