/**
 * PromptPlusMenu is intentionally source-tested because its renderer-only
 * dependencies require Electron IPC. This guards the hook imports used by the
 * skill and expert selectors so toolbar changes cannot make the prompt view
 * fail at runtime.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

const source = readFileSync(
  fileURLToPath(new URL('./PromptPlusMenu.tsx', import.meta.url)),
  'utf8',
);

test('imports the hooks used by prompt menu selectors', () => {
  expect(source).toContain(
    "import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';",
  );
  expect(source).toContain('const enabledSkills = useMemo(');
  expect(source).toContain('const availableExperts = useMemo(');
});

test('preserves MCP controls in the connector submenu', () => {
  expect(source).toContain('handleToggleServer');
  expect(source).toContain('<DropdownMenuSubTrigger>');
  expect(source).toContain("i18nService.t('loading')");
  expect(source).toContain('checked={server.enabled}');
  expect(source).toContain('onCheckedChange={checked => {');
  expect(source).toContain('onClick={event => event.stopPropagation()}');
  expect(source).not.toContain('className="pointer-events-none ml-auto"');
  expect(source).toContain("i18nService.t('manageConnectors')");
});
