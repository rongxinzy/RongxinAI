import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

const source = readFileSync(
  fileURLToPath(new URL('./CodingAuthAndPermissionDialogs.tsx', import.meta.url)),
  'utf8',
);

test('uses the work-mode permission information hierarchy', () => {
  expect(source).toContain('<DialogHeader className="flex-row items-start gap-4">');
  expect(source).toContain('w-[30vw] !max-w-none');
  expect(source).toContain('size-10');
  expect(source).toContain('size-5');
  expect(source).toContain('surface={DialogFooterSurface.Seamless}');
  expect(source).not.toContain("i18nService.t('codingAgentPermissionToolInput')");
  expect(source).not.toContain("i18nService.t('codingAgentPermissionToolDescription')");
  expect(source).not.toContain("i18nService.t('codingAgentPermissionToolName')");
  expect(source).toContain('code={permissionInput}');
  expect(source).toContain('language="json"');
  expect(source).toContain('showLineNumbers');
  expect(source).toContain('lineNumberMode={CodeBlockLineNumberMode.Approval}');
  expect(source).toContain('showDivider={false}');
  expect(source).toContain('surface={CodeBlockHeaderSurface.Seamless}');
  expect(source).toContain('<CodeBlockTitle>{i18nService.t(\'codingAgentTool\')}</CodeBlockTitle>');
  expect(source).not.toContain('rounded-xl border border-border p-4');
  expect(source).toContain("i18nService.t('copy')");
  expect(source).not.toContain("i18nService.t('copyToClipboard')");
  expect(source).toContain('className="max-h-56 min-w-0 max-w-full overflow-hidden"');
  expect(source).toContain('className="min-w-0"');
  expect(source).toContain('<CodeBlockCopyButton');
  expect(source).toContain('className="grid grid-cols-1 md:grid-cols-3"');
  expect(source).toContain('className="min-w-0 truncate"');
  expect(source).not.toContain("i18nService.t('codingAgentCancelPermission')");
  expect(source).toContain('isCommandAllowPermissionOption');
  expect(source).toContain('CodingPermissionOptionName.Reject');
  expect(source).toContain("option.kind === CodingPermissionOptionKind.RejectOnce");
  expect(source).toContain("? 'outline'");
  expect(source).toContain("option.kind === CodingPermissionOptionKind.RejectAlways");
  expect(source).toContain("? 'destructive'");
});
