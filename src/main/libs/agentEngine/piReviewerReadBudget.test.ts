import * as fs from 'fs';
import * as os from 'os';
import path from 'path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  PiExtensionEventType,
  type PiExtensionApi,
  type PiToolCallEvent,
  type PiToolResultEvent,
} from './piExtensionTypes';
import {
  createPiReviewerReadBudgetExtension,
  PiReviewerReadBudget,
  PiReviewerReadToolName,
} from './piReviewerReadBudget';

const temporaryDirectories: string[] = [];

const createWorkspace = (): string => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-reviewer-read-budget-'));
  temporaryDirectories.push(workspace);
  return workspace;
};

const readCall = (toolCallId: string, input: Record<string, unknown>): PiToolCallEvent => ({
  toolCallId,
  toolName: PiReviewerReadToolName.Read,
  input,
});

const readResult = (toolCallId: string, isError = false): PiToolResultEvent => ({
  toolCallId,
  toolName: PiReviewerReadToolName.Read,
  isError,
});

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('PiReviewerReadBudget', () => {
  it('blocks an exact file range after its first request', () => {
    const budget = new PiReviewerReadBudget(createWorkspace());

    expect(
      budget.handleToolCall(readCall('read-1', { path: 'src/app.ts', offset: 10, limit: 50 })),
    ).toBeUndefined();
    expect(
      budget.handleToolCall(readCall('read-2', { path: 'src/app.ts', offset: 10, limit: 50 })),
    ).toMatchObject({ block: true, reason: expect.stringContaining('exact file range') });
  });

  it('allows distinct ranges from the same file', () => {
    const budget = new PiReviewerReadBudget(createWorkspace());

    expect(
      budget.handleToolCall(readCall('read-1', { path: 'src/app.ts', offset: 1, limit: 100 })),
    ).toBeUndefined();
    expect(
      budget.handleToolCall(readCall('read-2', { path: 'src/app.ts', offset: 101, limit: 100 })),
    ).toBeUndefined();
  });

  it('supports path aliases and canonicalizes relative and absolute paths', () => {
    const workspace = createWorkspace();
    const sourceDirectory = path.join(workspace, 'src');
    const filePath = path.join(sourceDirectory, 'app.ts');
    fs.mkdirSync(sourceDirectory);
    fs.writeFileSync(filePath, 'export const app = true;');
    const budget = new PiReviewerReadBudget(workspace);

    expect(
      budget.handleToolCall(readCall('read-1', { file_path: path.join('src', 'app.ts') })),
    ).toBeUndefined();
    expect(
      budget.handleToolCall(readCall('read-2', { path: filePath, offset: 1, limit: 2_000 })),
    ).toMatchObject({ block: true });
  });

  it('normalizes path casing when the filesystem is case-insensitive', () => {
    const budget = new PiReviewerReadBudget(createWorkspace(), {
      caseInsensitivePaths: true,
    });

    expect(
      budget.handleToolCall(readCall('read-1', { path: path.join('src', 'File.ts') })),
    ).toBeUndefined();
    expect(
      budget.handleToolCall(readCall('read-2', { path: path.join('SRC', 'file.ts') })),
    ).toMatchObject({ block: true });
  });

  it('blocks a fourth range from the same file', () => {
    const budget = new PiReviewerReadBudget(createWorkspace());
    for (let index = 0; index < 3; index += 1) {
      expect(
        budget.handleToolCall(
          readCall(`read-${index}`, {
            path: 'src/app.ts',
            offset: index * 100 + 1,
            limit: 100,
          }),
        ),
      ).toBeUndefined();
    }

    expect(
      budget.handleToolCall(readCall('read-4', { path: 'src/app.ts', offset: 301, limit: 100 })),
    ).toMatchObject({ block: true, reason: expect.stringContaining('per-file read budget') });
  });

  it('blocks ranges that exceed the cumulative requested-line budget', () => {
    const budget = new PiReviewerReadBudget(createWorkspace());

    expect(
      budget.handleToolCall(readCall('read-1', { path: 'src/app.ts', offset: 1, limit: 4_000 })),
    ).toBeUndefined();
    expect(
      budget.handleToolCall(
        readCall('read-2', { path: 'src/app.ts', offset: 4_001, limit: 2_001 }),
      ),
    ).toMatchObject({ block: true, reason: expect.stringContaining('requested-line') });
  });

  it('rolls back a failed read so the same range can be retried', () => {
    const budget = new PiReviewerReadBudget(createWorkspace());

    expect(
      budget.handleToolCall(readCall('read-1', { path: 'src/app.ts', offset: 1, limit: 100 })),
    ).toBeUndefined();
    budget.handleToolResult(readResult('read-1', true));

    expect(
      budget.handleToolCall(readCall('read-2', { path: 'src/app.ts', offset: 1, limit: 100 })),
    ).toBeUndefined();
  });

  it('does not budget non-read tools', () => {
    const budget = new PiReviewerReadBudget(createWorkspace());
    const event = { toolCallId: 'grep-1', toolName: 'grep', input: { path: 'src/app.ts' } };

    expect(budget.handleToolCall(event)).toBeUndefined();
    expect(budget.handleToolCall(event)).toBeUndefined();
  });

  it('signals budget exhaustion once and registers both extension hooks', () => {
    const budget = new PiReviewerReadBudget(createWorkspace());
    const listener = vi.fn();
    budget.subscribeLimitExceeded(listener);
    const handlers = new Map<string, (event: PiToolCallEvent | PiToolResultEvent) => unknown>();

    createPiReviewerReadBudgetExtension(budget)({
      on: (event: string, handler: (value: never) => unknown) => {
        handlers.set(event, handler as (value: PiToolCallEvent | PiToolResultEvent) => unknown);
      },
    } as unknown as PiExtensionApi);

    expect(handlers.has(PiExtensionEventType.ToolCall)).toBe(true);
    expect(handlers.has(PiExtensionEventType.ToolResult)).toBe(true);
    handlers.get(PiExtensionEventType.ToolCall)?.(readCall('read-1', { path: 'src/app.ts' }));
    handlers.get(PiExtensionEventType.ToolCall)?.(readCall('read-2', { path: 'src/app.ts' }));
    handlers.get(PiExtensionEventType.ToolCall)?.(readCall('read-3', { path: 'src/app.ts' }));

    expect(listener).toHaveBeenCalledOnce();
  });
});
