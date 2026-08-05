/**
 * Source-structure guard for CoworkPromptInput's skill badge placement.
 *
 * Why not render the component? CoworkPromptInput's import chain pulls in
 * window.electron IPC services (cowork/agent/config), ai-elements, and
 * module-level / render-time browser globals (`navigator.platform`,
 * `configService.getConfig()` inside a useState initializer). Rendering it
 * under this repo's node-environment Vitest setup (no jsdom) would require
 * mocking most of the renderer service layer, so this guard pins the two
 * facts PR #184 broke instead:
 *
 *   1. ActiveSkillBadge stays mounted in the prompt toolbar
 *      (inside PromptInputTools, next to the "+" menu).
 *   2. The broken textarea-internal grey-token implementation
 *      (ResizeObserver width measurement, dynamic paddingLeft, placeholder
 *      suppression while skills are active) stays gone.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

const source = readFileSync(
  fileURLToPath(new URL('./CoworkPromptInput.tsx', import.meta.url)),
  'utf8',
);

test('mounts ActiveSkillBadge inside the prompt toolbar', () => {
  expect(source).toContain('<ActiveSkillBadge />');

  const toolsOpen = source.indexOf('<PromptInputTools');
  const badge = source.indexOf('<ActiveSkillBadge />');
  const toolsClose = source.indexOf('</PromptInputTools>');
  expect(toolsOpen).toBeGreaterThanOrEqual(0);
  expect(toolsClose).toBeGreaterThan(toolsOpen);
  expect(badge).toBeGreaterThan(toolsOpen);
  expect(badge).toBeLessThan(toolsClose);
});

test('does not reintroduce the PR #184 textarea-token implementation', () => {
  // ResizeObserver-driven width measurement for the inline tokens.
  expect(source).not.toContain('skillTokensRef');
  expect(source).not.toContain('skillTokenWidth');
  // The broken version cleared the textarea placeholder while skills were active.
  expect(source).not.toContain("? '' : placeholder");
});

test('keeps the session permission selector available during an active run', () => {
  const permissionMenuStart = source.indexOf('<PermissionModeMenu');
  const permissionMenuEnd = source.indexOf('/>', permissionMenuStart);
  const permissionMenu = source.slice(permissionMenuStart, permissionMenuEnd);

  expect(permissionMenuStart).toBeGreaterThanOrEqual(0);
  expect(permissionMenu).toContain('onChange={mode => onPermissionModeChange?.(mode)}');
  expect(permissionMenu).toContain('disabled={disabled}');
  expect(permissionMenu).not.toContain('disabled={disabled || isStreaming}');
});

test('keeps the active-run mask visible while a permission request disables the prompt', () => {
  expect(source).toContain('{isStreaming && !canQueueWhileStreaming && (');
  expect(source).not.toContain('isStreaming && !disabled && !canQueueWhileStreaming');
});
