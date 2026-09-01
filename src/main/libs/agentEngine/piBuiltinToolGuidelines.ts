/**
 * Usage guidelines for Pi's built-in file tools.
 *
 * Pi drops each built-in tool's `promptGuidelines` whenever a custom system
 * prompt is supplied (buildSystemPrompt returns the custom prompt before the
 * Guidelines section is composed). ZhiYuan always supplies one, so these
 * rules are appended via appendSystemPromptOverride to keep them present.
 * Keep in sync with the upstream contributions in pi-coding-agent
 * (core/tools/{read,edit}); the upstream write guideline is intentionally
 * owned by the large-file-write policy (piWriteTokenLimit), which states the
 * same rule with its chunking limits.
 */
export const PiBuiltinFileToolSystemPrompt = [
  '## File tool usage',
  '',
  '- Use `read` to examine files instead of `cat` or `sed`.',
  '- Use `edit` for precise changes; `edits[].oldText` must match the file content exactly.',
  '- When changing multiple separate locations in one file, use one `edit` call with multiple entries in `edits[]` instead of multiple `edit` calls.',
  '- Each `edits[].oldText` is matched against the original file, not after earlier edits are applied. Do not emit overlapping or nested edits; merge nearby changes into one entry.',
  '- Keep `edits[].oldText` as small as possible while still being unique in the file.',
].join('\n');
