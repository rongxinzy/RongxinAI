import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

const source = readFileSync(
  fileURLToPath(new URL('./CodingAuthTerminalDialog.tsx', import.meta.url)),
  'utf8',
);

test('keeps the terminal hand-off dialog limited to the auth terminal', () => {
  expect(source).toContain("i18nService.t('codingAgentTerminalAuthentication')");
  expect(source).toContain("i18nService.t('codingAgentTerminalAuthenticationDescription')");
  expect(source).toContain('<Terminal output={authTerminal.output}');
  expect(source).toContain('className="max-h-[45dvh] overflow-auto"');
  expect(source).toContain("i18nService.t('codingAgentTerminalInput')");
  expect(source).toContain("i18nService.t('codingAgentSend')");
  expect(source).toContain("i18nService.t('codingAgentHandoffCancel')");
});

test('no longer carries the permission dialog', () => {
  expect(source).not.toContain('parseCodingPermission');
  expect(source).not.toContain('isCommandAllowPermissionOption');
  expect(source).not.toContain('CodingPermissionOutcome');
  expect(source).not.toContain('DialogFooterSurface');
});
