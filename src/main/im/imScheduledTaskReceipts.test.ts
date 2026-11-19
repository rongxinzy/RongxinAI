import { expect, test } from 'vitest';

import type { CoworkMessage } from '../coworkStore';
import { readIMScheduledTaskReceipts } from './imScheduledTaskReceipts';

function call(toolUseId: string, name: string, action?: string): CoworkMessage {
  return {
    id: `call-${toolUseId}`,
    type: 'tool_use',
    content: '',
    timestamp: 0,
    metadata: { toolUseId, toolName: name, ...(action && { toolInput: { action } }) },
  };
}

function receipt(toolUseId: string, isError?: boolean): CoworkMessage {
  return {
    id: `receipt-${toolUseId}`,
    type: 'tool_result',
    content: '',
    timestamp: 0,
    metadata: { toolUseId, isError },
  };
}

test('requires a same-turn scheduling call and explicit tool outcome', () => {
  expect(
    readIMScheduledTaskReceipts([
      receipt('other-turn', false),
      call('list', 'cron', 'list'),
      receipt('list', true),
      call('missing', 'scheduled_task'),
      receipt('missing'),
    ]),
  ).toEqual({ created: false, failed: false });
});

test('recognizes successful native creation and explicit legacy creation failure', () => {
  expect(
    readIMScheduledTaskReceipts([
      call('current', 'scheduled_task'),
      receipt('current', false),
      call('legacy', 'Cron', 'add'),
      receipt('legacy', true),
    ]),
  ).toEqual({ created: true, failed: true });
});
