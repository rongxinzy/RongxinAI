import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  readIMScheduledTaskReceipts,
} = require('../dist-electron/main/im/imScheduledTaskReceipts.js');

test('reads structured task creation receipts from the compiled module', () => {
  const toolUseId = 'task-call';
  const call = { type: 'tool_use', metadata: { toolUseId, toolName: 'scheduled_task' } };
  const receipt = { type: 'tool_result', metadata: { toolUseId, isError: false } };
  assert.deepEqual(readIMScheduledTaskReceipts([receipt]), { created: false, failed: false });
  assert.deepEqual(readIMScheduledTaskReceipts([call, receipt]), { created: true, failed: false });
});
