import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

const source = readFileSync(
  fileURLToPath(new URL('./InlineSkillPromptEditor.tsx', import.meta.url)),
  'utf8',
);

test('uses one editable surface for skill tokens and prompt text', () => {
  expect(source).toContain('contentEditable={!disabled}');
  expect(source).toContain("token.dataset.skillToken = skillId");
  expect(source).toContain('range.insertNode(token);');
});

test('normalizes paste and block-element newlines before updating prompt text', () => {
  expect(source).toContain("event.clipboardData.getData('text/plain')");
  expect(source).toContain('event.preventDefault();');
  expect(source).toContain("node.tagName === 'DIV' || node.tagName === 'P'");
});

test('restores the mixed token and text DOM when a send is rejected', () => {
  expect(source).toContain('contentSnapshotRef');
  expect(source).toContain('pendingRestoreValueRef');
  expect(source).toContain('editor.replaceChildren(contentSnapshotRef.current.cloneNode(true));');
});

test('shows removal in the icon slot only while hovering a token', () => {
  expect(source).toContain('bg-(--zy-skill-blue-background)');
  expect(source).toContain('inline-flex h-6');
  expect(source).toContain('group-hover:opacity-0');
  expect(source).toContain('group-hover:pointer-events-auto');
});

test('keeps token removal available by click and keyboard', () => {
  expect(source).toContain('data-remove-skill-id');
  expect(source).toContain("event.key === 'Backspace' || event.key === 'Delete'");
  expect(source).toContain('dispatch(toggleActiveSkill(skillId));');
});
