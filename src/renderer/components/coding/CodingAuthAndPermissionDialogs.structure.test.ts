import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

const source = readFileSync(
  fileURLToPath(new URL('./CodingAuthAndPermissionDialogs.tsx', import.meta.url)),
  'utf8',
);

test('uses the work-mode permission information hierarchy', () => {
  expect(source).toContain('<DialogHeader className="flex-row items-start gap-4">');
  expect(source).toContain('w-[60vw] !max-w-none');
  expect(source).toContain("i18nService.t('codingAgentPermissionToolInput')");
  expect(source).not.toContain("i18nService.t('codingAgentPermissionToolName')");
  expect(source).toContain('<CodeBlock code={permissionInput} language="json" showLineNumbers>');
  expect(source).toContain('<CodeBlockCopyButton');
  expect(source).toContain('className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5"');
  expect(source).toContain('className="min-w-0 truncate"');
  expect(source).toContain("option.kind === CodingPermissionOptionKind.AllowAlways");
  expect(source).toContain("? 'outline'");
  expect(source).toContain("option.kind === CodingPermissionOptionKind.RejectAlways");
  expect(source).toContain("? 'destructive'");
});
