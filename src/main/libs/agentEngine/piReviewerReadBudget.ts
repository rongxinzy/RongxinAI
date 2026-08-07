import * as fs from 'fs';
import path from 'path';

import {
  PiExtensionEventType,
  type PiExtensionFactory,
  type PiToolCallEvent,
  type PiToolCallEventResult,
  type PiToolResultEvent,
} from './piExtensionTypes';

export const PiReviewerReadBudgetLimit = {
  DefaultRangeLines: 2_000,
  MaxRangesPerFile: 3,
  MaxRequestedLinesPerFile: 6_000,
} as const;

export const PiReviewerReadToolName = {
  Read: 'read',
} as const;

const PiReviewerReadBudgetBlockReason = {
  DuplicateRange:
    'This exact file range was already read. Reuse the existing evidence or inspect a different range, then return the verdict.',
  RangeLimit:
    'The per-file read budget is exhausted. Reuse the existing evidence and return the best-supported verdict now.',
  LineLimit:
    'The per-file requested-line budget is exhausted. Reuse the existing evidence and return the best-supported verdict now.',
} as const;

interface ReviewerReadRequest {
  pathKey: string;
  rangeKey: string;
  requestedLines: number;
}

interface ReviewerFileReadState {
  rangeKeys: Set<string>;
  requestedLines: number;
}

export interface PiReviewerReadBudgetOptions {
  caseInsensitivePaths?: boolean;
}

const readPositiveInteger = (value: unknown, fallback: number): number | undefined => {
  if (value === undefined) return fallback;
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
};

const extractReadRequest = (
  workspaceRoot: string,
  input: unknown,
  caseInsensitivePaths: boolean,
): ReviewerReadRequest | undefined => {
  if (!input || typeof input !== 'object') return undefined;
  const rawInput = input as Record<string, unknown>;
  const rawPath =
    typeof rawInput.path === 'string'
      ? rawInput.path
      : typeof rawInput.file_path === 'string'
        ? rawInput.file_path
        : undefined;
  if (!rawPath) return undefined;

  const offset = readPositiveInteger(rawInput.offset, 1);
  const limit = readPositiveInteger(rawInput.limit, PiReviewerReadBudgetLimit.DefaultRangeLines);
  if (offset === undefined || limit === undefined) return undefined;

  let resolvedPath = path.normalize(path.resolve(workspaceRoot, rawPath));
  try {
    if (fs.existsSync(resolvedPath)) {
      resolvedPath = path.normalize(fs.realpathSync.native(resolvedPath));
    }
  } catch {
    // Let the read tool report filesystem errors; budget identity falls back to the resolved path.
  }
  const pathKey = caseInsensitivePaths ? resolvedPath.toLowerCase() : resolvedPath;
  return {
    pathKey,
    rangeKey: `${offset}:${limit}`,
    requestedLines: limit,
  };
};

export class PiReviewerReadBudget {
  private readonly fileStates = new Map<string, ReviewerFileReadState>();
  private readonly pendingRequests = new Map<string, ReviewerReadRequest>();
  private readonly limitListeners = new Set<() => void>();
  private readonly caseInsensitivePaths: boolean;
  private limitSignalled = false;

  constructor(
    private readonly workspaceRoot: string,
    options: PiReviewerReadBudgetOptions = {},
  ) {
    this.caseInsensitivePaths = options.caseInsensitivePaths ?? process.platform === 'win32';
  }

  subscribeLimitExceeded(listener: () => void): () => void {
    this.limitListeners.add(listener);
    return () => this.limitListeners.delete(listener);
  }

  handleToolCall(event: PiToolCallEvent): PiToolCallEventResult | undefined {
    if (event.toolName.toLowerCase() !== PiReviewerReadToolName.Read) return undefined;
    const request = extractReadRequest(this.workspaceRoot, event.input, this.caseInsensitivePaths);
    if (!request) return undefined;

    const state = this.fileStates.get(request.pathKey) ?? {
      rangeKeys: new Set<string>(),
      requestedLines: 0,
    };
    if (state.rangeKeys.has(request.rangeKey)) {
      return this.block(PiReviewerReadBudgetBlockReason.DuplicateRange);
    }
    if (state.rangeKeys.size >= PiReviewerReadBudgetLimit.MaxRangesPerFile) {
      return this.block(PiReviewerReadBudgetBlockReason.RangeLimit);
    }
    if (
      state.requestedLines + request.requestedLines >
      PiReviewerReadBudgetLimit.MaxRequestedLinesPerFile
    ) {
      return this.block(PiReviewerReadBudgetBlockReason.LineLimit);
    }

    state.rangeKeys.add(request.rangeKey);
    state.requestedLines += request.requestedLines;
    this.fileStates.set(request.pathKey, state);
    this.pendingRequests.set(event.toolCallId, request);
    return undefined;
  }

  handleToolResult(event: PiToolResultEvent): void {
    const request = this.pendingRequests.get(event.toolCallId);
    if (!request) return;
    this.pendingRequests.delete(event.toolCallId);
    if (!event.isError) return;

    const state = this.fileStates.get(request.pathKey);
    if (!state) return;
    state.rangeKeys.delete(request.rangeKey);
    state.requestedLines = Math.max(0, state.requestedLines - request.requestedLines);
    if (state.rangeKeys.size === 0) {
      this.fileStates.delete(request.pathKey);
    }
  }

  private block(reason: string): PiToolCallEventResult {
    if (!this.limitSignalled) {
      this.limitSignalled = true;
      for (const listener of this.limitListeners) {
        try {
          listener();
        } catch (error) {
          console.warn('[PiReviewerReadBudget] failed to signal the read limit:', error);
        }
      }
    }
    return { block: true, reason };
  }
}

export const createPiReviewerReadBudgetExtension =
  (budget: PiReviewerReadBudget): PiExtensionFactory =>
  extensionApi => {
    extensionApi.on(PiExtensionEventType.ToolCall, event => budget.handleToolCall(event));
    extensionApi.on(PiExtensionEventType.ToolResult, event => budget.handleToolResult(event));
  };
