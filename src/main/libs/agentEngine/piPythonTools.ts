import type { ToolAnnotations, ToolDefinition } from '@earendil-works/pi-coding-agent';
import { Type, type Static } from 'typebox';

import type { PythonExecutionResult } from '../../../shared/pythonRuntime';
import type { PythonRuntimeService } from '../../pythonRuntime/service';
import { PI_CUSTOM_TOOL_MAX_OUTPUT_CHARS, truncateToolTextHeadTail } from './piToolOutputLimit';

export const PI_PYTHON_TOOL_MAX_OUTPUT_CHARS = PI_CUSTOM_TOOL_MAX_OUTPUT_CHARS;

export const PiPythonToolName = {
  Execute: 'python_execute',
  Install: 'python_install',
} as const;
export type PiPythonToolName = (typeof PiPythonToolName)[keyof typeof PiPythonToolName];

export type PiPythonToolAuthorizationCall = {
  toolName: PiPythonToolName;
  toolInput: Record<string, unknown>;
  callId: string;
  signal?: AbortSignal;
};

type PiPythonToolAuthorizationResult = {
  allow: boolean;
  reason?: string;
  updatedInput?: Record<string, unknown>;
};

export type PiPythonToolsOptions = {
  service: Pick<PythonRuntimeService, 'execute' | 'install'>;
  workspace: string;
  authorize?: (call: PiPythonToolAuthorizationCall) => Promise<PiPythonToolAuthorizationResult>;
};

const PiPythonOutputSchema = Type.Object({
  stdout: Type.String({ description: 'Standard output captured from the execution.' }),
  stderr: Type.String({ description: 'Standard error captured from the execution.' }),
  exitCode: Type.Integer({ description: 'Process exit code (0 indicates success).' }),
  environmentId: Type.String({ description: 'Target Python virtual environment identifier.' }),
  runtimeId: Type.String({ description: 'Runtime interpreter identifier.' }),
  truncated: Type.Boolean({ description: 'Whether the output was truncated due to size limits.' }),
});
type PiPythonOutput = Static<typeof PiPythonOutputSchema>;

const PiPythonExecuteAnnotations: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  openWorldHint: false,
};

const PiPythonInstallAnnotations: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

type PiPythonToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  details: PythonExecutionResult;
  structuredContent: PythonExecutionResult;
};

const PiPythonExecuteParameters = Type.Object({
  code: Type.String({ maxLength: 1048576 }),
  timeoutMs: Type.Optional(Type.Integer({ minimum: 100, maximum: 600000 })),
});

const PiPythonInstallParameters = Type.Object({
  packages: Type.Array(
    Type.String({
      maxLength: 200,
      description: 'PyPI wheel spec (e.g. packaging, requests>=2.31,<3).',
    }),
    { maxItems: 40 },
  ),
  rebuild: Type.Optional(
    Type.Boolean({ description: 'Set true only when explicitly asked to rebuild.' }),
  ),
});

const formatResult = (result: PythonExecutionResult): PiPythonToolResult => {
  let boundedResult = result;
  if (result.stdout.length + result.stderr.length > PI_PYTHON_TOOL_MAX_OUTPUT_CHARS) {
    // Preserve tracebacks/errors by sizing stderr first, then assigning the remainder to stdout.
    const stderrBudget = Math.min(
      result.stderr.length,
      Math.max(
        Math.floor(PI_PYTHON_TOOL_MAX_OUTPUT_CHARS * 0.5),
        PI_PYTHON_TOOL_MAX_OUTPUT_CHARS - result.stdout.length,
      ),
    );
    const stdoutBudget = Math.max(0, PI_PYTHON_TOOL_MAX_OUTPUT_CHARS - stderrBudget);
    const clippedStderr = truncateToolTextHeadTail(result.stderr, stderrBudget);
    const clippedStdout = truncateToolTextHeadTail(result.stdout, stdoutBudget);
    boundedResult = {
      ...result,
      stdout: clippedStdout.text,
      stderr: clippedStderr.text,
      truncated: result.truncated || clippedStdout.truncated || clippedStderr.truncated,
    };
  }
  const text = JSON.stringify(boundedResult);
  if (boundedResult.exitCode !== 0) {
    throw new Error(text);
  }
  return {
    content: [{ type: 'text', text }],
    details: boundedResult,
    structuredContent: boundedResult,
  };
};

export function buildPiPythonTools(options: PiPythonToolsOptions): ToolDefinition[] {
  const { service, workspace, authorize } = options;

  const checkAuthorization = async (
    toolName: PiPythonToolName,
    callId: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> => {
    if (!authorize) return params;
    const decision = await authorize({
      toolName,
      toolInput: params,
      callId,
      signal,
    });
    if (!decision.allow) {
      throw new Error(decision.reason || 'The action was not approved.');
    }
    return decision.updatedInput ?? params;
  };

  const executeTool: ToolDefinition<typeof PiPythonExecuteParameters, PiPythonOutput> = {
    name: PiPythonToolName.Execute,
    label: 'Python Execute',
    description:
      'Execute Python in the managed workspace venv (bundled office/PDF libs + installed wheels). Returns {stdout, stderr, exitCode}.',
    promptSnippet: 'Execute Python in the workspace managed environment.',
    parameters: PiPythonExecuteParameters,
    outputSchema: PiPythonOutputSchema,
    annotations: PiPythonExecuteAnnotations,
    execute: async (
      toolCallId: string,
      params: { code: string; timeoutMs?: number },
      signal?: AbortSignal,
    ): Promise<PiPythonToolResult> => {
      const authorized = (await checkAuthorization(
        PiPythonToolName.Execute,
        toolCallId,
        params as unknown as Record<string, unknown>,
        signal,
      )) as { code: string; timeoutMs?: number };
      const result = await service.execute(
        {
          workspace,
          code: authorized.code,
          ...(authorized.timeoutMs !== undefined ? { timeoutMs: authorized.timeoutMs } : {}),
        },
        signal,
      );
      return formatResult(result);
    },
  };

  const installTool: ToolDefinition<typeof PiPythonInstallParameters, PiPythonOutput> = {
    name: PiPythonToolName.Install,
    label: 'Python Install',
    description:
      'Install PyPI wheel packages by name or version spec into this workspace venv (no URLs or local paths).',
    promptSnippet: 'Install PyPI wheel packages into the workspace venv.',
    parameters: PiPythonInstallParameters,
    outputSchema: PiPythonOutputSchema,
    annotations: PiPythonInstallAnnotations,
    execute: async (
      toolCallId: string,
      params: { packages: string[]; rebuild?: boolean },
      signal?: AbortSignal,
    ): Promise<PiPythonToolResult> => {
      const authorized = (await checkAuthorization(
        PiPythonToolName.Install,
        toolCallId,
        params as unknown as Record<string, unknown>,
        signal,
      )) as { packages: string[]; rebuild?: boolean };
      const result = await service.install(
        {
          workspace,
          packages: authorized.packages,
          ...(authorized.rebuild !== undefined ? { rebuild: authorized.rebuild } : {}),
        },
        signal,
      );
      return formatResult(result);
    },
  };

  return [executeTool as unknown as ToolDefinition, installTool as unknown as ToolDefinition];
}
