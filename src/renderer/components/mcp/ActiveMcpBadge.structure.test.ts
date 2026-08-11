/**
 * Source-structure guard for the compact MCP control beside the prompt plus
 * button. Rendering needs Electron IPC and browser-only renderer services, so
 * this keeps the composition and its enable/disable behavior covered in the
 * node Vitest environment.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

const source = readFileSync(
  fileURLToPath(new URL('./ActiveMcpBadge.tsx', import.meta.url)),
  'utf8',
);

test('renders enabled MCPs as one stacked dropdown trigger', () => {
  expect(source).toContain('<DropdownMenu open={open} onOpenChange={setOpen}>');
  expect(source).toContain(
    'const enabledServers = useMemo(() => servers.filter(server => server.enabled), [servers]);',
  );
  expect(source).toContain('className="flex h-7 items-center rounded-md bg-muted px-1"');
  expect(source).toContain('className="-ml-2 flex size-5 shrink-0');
  expect(source.match(/enabledServers\.map\(server => \(/g)).toHaveLength(2);
  expect(source).not.toContain('data-popup-open:shadow-subtle');
  expect(source).toContain('const mcpIconCache = new Map<string, string>();');
  expect(source).not.toContain('<Cable className="size-3.5 text-muted-foreground" />');
});

test('keeps every enabled MCP switch available in the dropdown', () => {
  expect(source).toContain('closeOnClick={false}');
  expect(source).toContain('void handleToggleServer(server.id, !server.enabled);');
  expect(source).toContain('checked={server.enabled}');
  expect(source).toContain('onCheckedChange={checked => {');
  expect(source).toContain('onClick={event => event.stopPropagation()}');
  expect(source).not.toContain('className="pointer-events-none ml-auto"');
});

test('opens the MCP configuration menu above the prompt input', () => {
  expect(source).toContain('<DropdownMenuContent side="top" align="start" sideOffset={4}');
});

test('does not highlight the first MCP until the pointer enters its row while preserving keyboard focus', () => {
  expect(source).toContain(
    'className="focus:bg-transparent focus-visible:bg-muted hover:bg-muted focus:hover:bg-muted"',
  );
});
