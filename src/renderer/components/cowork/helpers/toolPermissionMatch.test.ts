import { expect, test } from 'vitest';

import { CoworkPermissionOrigin } from '../../../../shared/cowork/constants';
import type { CoworkMessage, CoworkPermissionRequest } from '../../../types/cowork';
import { findToolGroupForPermission } from './toolPermissionMatch';
import type { AssistantTurnItem, ToolGroupItem } from './messageGrouping';

const toolUse = (overrides: Partial<CoworkMessage> = {}): CoworkMessage => ({
  id: 'tool-1',
  type: 'tool_use',
  content: '',
  timestamp: 1,
  metadata: {
    toolName: 'Bash',
    toolUseId: 'call-1',
    toolInput: { command: 'python -c "import pptx; print(\'ok\')"' },
  },
  ...overrides,
});

const group = (use: CoworkMessage, result?: CoworkMessage | null): ToolGroupItem => ({
  type: 'tool_group',
  toolUse: use,
  toolResult: result ?? null,
});

const item = (toolGroup: ToolGroupItem): AssistantTurnItem => ({
  type: 'tool_group',
  group: toolGroup,
});

const permission = (overrides: Partial<CoworkPermissionRequest> = {}): CoworkPermissionRequest => ({
  origin: CoworkPermissionOrigin.PiWorkbench,
  sessionId: 'session-1',
  requestId: 'req-1',
  toolName: 'Bash',
  toolInput: { command: 'python -c "import pptx; print(\'ok\')"' },
  toolUseId: 'call-1',
  ...overrides,
});

test('matches a running tool by toolUseId', () => {
  const bash = group(toolUse());
  expect(findToolGroupForPermission([item(bash)], permission())).toBe(bash);
});

test('matches a running bash tool by command when ids are missing', () => {
  const listed = group(toolUse({ metadata: { toolName: 'Bash', toolInput: { command: 'ls' } } }));
  expect(
    findToolGroupForPermission(
      [item(listed)],
      permission({ toolUseId: null, toolInput: { command: 'ls' } }),
    ),
  ).toBe(listed);
});

test('does not guess when multiple running tools share a name', () => {
  const first = group(
    toolUse({ id: 'tool-a', metadata: { toolName: 'Bash', toolInput: { command: 'ls' } } }),
  );
  const second = group(
    toolUse({ id: 'tool-b', metadata: { toolName: 'Bash', toolInput: { command: 'pwd' } } }),
  );
  expect(
    findToolGroupForPermission(
      [item(first), item(second)],
      permission({ toolUseId: null, toolInput: {} }),
    ),
  ).toBeNull();
});

test('does not attach permission to a completed tool', () => {
  expect(
    findToolGroupForPermission(
      [
        item(
          group(toolUse(), {
            id: 'result-1',
            type: 'tool_result',
            content: 'ok',
            timestamp: 2,
            metadata: { toolUseId: 'call-1' },
          }),
        ),
      ],
      permission(),
    ),
  ).toBeNull();
});

test('falls back to the only running tool with the same name', () => {
  const onlyBash = group(
    toolUse({
      id: 'tool-2',
      metadata: { toolName: 'Bash', toolInput: { command: 'pwd' } },
    }),
  );
  expect(
    findToolGroupForPermission([item(onlyBash)], permission({ toolUseId: null, toolInput: {} })),
  ).toBe(onlyBash);
});
