import { describe, expect, it } from 'vitest';

import { CoworkPermissionMode } from '../../../shared/cowork/constants';
import { WorkbenchApprovalMode } from '../../../shared/workbenchTask';
import { PiToolPermissionGate } from '../../libs/agentEngine/piToolPermissionGate';
import { resolveCoworkApprovalMode } from './approvalMode';

describe('resolveCoworkApprovalMode', () => {
  it('maps Ask and undefined to Auto, and AllowAll to AllowAll', () => {
    expect(resolveCoworkApprovalMode(CoworkPermissionMode.Ask)).toBe(WorkbenchApprovalMode.Auto);
    expect(resolveCoworkApprovalMode(undefined)).toBe(WorkbenchApprovalMode.Auto);
    expect(resolveCoworkApprovalMode(CoworkPermissionMode.AllowAll)).toBe(
      WorkbenchApprovalMode.AllowAll,
    );
  });

  it('auto-approves reversible workspace edits under Ask->Auto while prompting for sensitive tools', async () => {
    const requestedTools: string[] = [];
    const gate = new PiToolPermissionGate({
      getWorkbenchTaskService: () => null,
      emit: (event, _sidOrId, payload) => {
        if (event === 'permissionRequest' && payload && typeof payload === 'object') {
          const req = payload as { requestId: string; toolName: string };
          requestedTools.push(req.toolName);
          queueMicrotask(() => gate.resolvePermission(req.requestId, { behavior: 'allow' }));
        }
      },
    });
    const approvalMode = resolveCoworkApprovalMode(CoworkPermissionMode.Ask);

    // Reversible workspace file ops + read-only memory recall run without interruption
    await expect(
      gate.authorizeToolCall({
        sessionId: 's1',
        runId: null,
        toolCallId: 'c1',
        toolName: 'write',
        toolInput: { path: 'a.txt', content: 'hi' },
        approvalMode,
      }),
    ).resolves.toEqual({ allow: true });
    await expect(
      gate.authorizeToolCall({
        sessionId: 's1',
        runId: null,
        toolCallId: 'c2',
        toolName: 'edit',
        toolInput: { path: 'a.txt' },
        approvalMode,
      }),
    ).resolves.toEqual({ allow: true });
    await expect(
      gate.authorizeToolCall({
        sessionId: 's1',
        runId: null,
        toolCallId: 'c3',
        toolName: 'memory',
        toolInput: { action: 'recall', query: 'x' },
        approvalMode,
      }),
    ).resolves.toEqual({ allow: true });
    expect(requestedTools).toEqual([]);

    // Sensitive actions still require user approval
    for (const [toolCallId, toolName, toolInput, annotations] of [
      ['c4', 'bash', { command: 'rm -rf tmp' }, undefined],
      ['c5', 'bash', { command: 'npm test' }, undefined],
      [
        'c6',
        'python_execute',
        { code: 'print(1)' },
        { readOnlyHint: false, destructiveHint: false },
      ],
      ['c7', 'run_skill_script', { skillId: 'xlsx', script: 'scripts/run.py' }, undefined],
    ] as const) {
      await expect(
        gate.authorizeToolCall({
          sessionId: 's1',
          runId: null,
          toolCallId,
          toolName,
          toolInput,
          approvalMode,
          annotations,
        }),
      ).resolves.toEqual({ allow: true });
    }
    expect(requestedTools).toEqual(['bash', 'bash', 'python_execute', 'run_skill_script']);
  });
});
