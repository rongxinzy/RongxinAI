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
  '- Use `edit` for precise changes. Batch separate changes to one file in one `edits[]` call.',
  '- Each `edits[].oldText` must exactly match the original file and be minimal but unique. Entries must not overlap or nest; merge nearby changes.',
].join('\n');
