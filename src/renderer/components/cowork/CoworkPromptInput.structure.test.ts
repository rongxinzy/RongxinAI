/**
 * Source-structure guard for CoworkPromptInput's inline skill editor.
 *
 * Why not render the component? CoworkPromptInput's import chain pulls in
 * window.electron IPC services (cowork/agent/config), ai-elements, and
 * module-level / render-time browser globals (`navigator.platform`,
 * `configService.getConfig()` inside a useState initializer). Rendering it
 * under this repo's node-environment Vitest setup (no jsdom) would require
 * mocking most of the renderer service layer, so this guard pins the two
 * facts PR #184 broke instead:
 *
 *   1. Skills and text share one editable surface, so tokens can be inserted
 *      at the current caret instead of being fixed before the textarea.
 *   2. The editor owns its DOM selection, avoiding resize/dynamic-padding
 *      token implementations that break input focus.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

const source = readFileSync(
  fileURLToPath(new URL('./CoworkPromptInput.tsx', import.meta.url)),
  'utf8',
);

test('mounts the inline skill editor inside the prompt body', () => {
  expect(source).toContain('<InlineSkillPromptEditor');

  const bodyOpen = source.indexOf('<PromptInputBody>');
  const editor = source.indexOf('<InlineSkillPromptEditor');
  const bodyClose = source.indexOf('</PromptInputBody>');
  expect(bodyOpen).toBeGreaterThanOrEqual(0);
  expect(bodyClose).toBeGreaterThan(bodyOpen);
  expect(editor).toBeGreaterThan(bodyOpen);
  expect(editor).toBeLessThan(bodyClose);
  expect(source).not.toContain('overflow-x-auto');
});

test('clears active skills after a successful submit', () => {
  expect(source).toContain('dispatch(clearActiveSkills());');
  expect(source).toContain('dispatch(clearSelection());');
});

test('delegates deletion-key handling to the inline editor', () => {
  expect(source).toContain('onKeyDown={handleKeyDown}');
  expect(source).not.toContain('event.currentTarget.value.length');
});

test('does not reintroduce the PR #184 measurement implementation', () => {
  expect(source).not.toContain('skillTokensRef');
  expect(source).not.toContain('skillTokenWidth');
  expect(source).toContain('InlineSkillPromptEditor');
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

test('keeps model, thinking, and permission controls reachable in compact toolbars', () => {
  const compactControlsStart = source.lastIndexOf('<div className="flex items-center gap-1.5">');
  const compactControls = source.slice(compactControlsStart);

  expect(compactControlsStart).toBeGreaterThanOrEqual(0);
  expect(compactControls).toContain('compact={isCompactToolbar}');
  expect(compactControls).toContain('isCompactToolbar && isWorkVariant');
  expect(compactControls).toContain('<PermissionModeMenu');
  expect(compactControls).toContain('showModelSelector');
});

test('places the active expert identity between permissions and MCP controls', () => {
  const permissionMenu = source.indexOf('<PermissionModeMenu');
  const expertBadge = source.lastIndexOf('<ActiveExpertBadge');
  const mcpBadge = source.lastIndexOf('<ActiveMcpBadge');

  expect(permissionMenu).toBeGreaterThanOrEqual(0);
  expect(expertBadge).toBeGreaterThan(permissionMenu);
  expect(mcpBadge).toBeGreaterThan(expertBadge);
  expect(source.slice(expertBadge, mcpBadge)).toContain('expertId={selectedExpertIds[0]}');
  expect(source.slice(expertBadge, mcpBadge)).toContain(
    'onRemove={() => setSelectedExpertIds([])}',
  );
});

test('keeps streaming controls gated without obscuring the prompt', () => {
  expect(source).not.toContain('bg-input/50 dark:bg-input/80');
  expect(source).not.toContain("className={isStreaming ? 'relative z-20' : undefined}");
  expect(source).toContain('disabled={disabled || isStreaming || isAddingFile}');
  expect(source.match(/disabled=\{disabled \|\| isStreaming\}/g)).toHaveLength(2);
  expect(source).toContain("status={isStreaming ? 'streaming' : 'ready'}");
  expect(source).toContain('onStop={isStreaming ? onStop : undefined}');
});

test('keeps text editing mounted while a target session context is pending', () => {
  expect(source).toContain('disabled={disabled}');
  expect(source).toContain('inert={sessionContextPending ? true : undefined}');
  expect(source).toContain('disabled={sessionContextPending}');
  expect(source).toContain('sessionContextPending ||');
});

test('allows an empty amendment only while an explicit task resume context is active', () => {
  expect(source).toContain('!trimmedValue && attachments.length === 0 && !resumeTaskActive');
  expect(source).toContain('<ResumeTaskContextBadge onCancel={onCancelTaskResume} />');
});
