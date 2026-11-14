import type { ToolAnnotations, ToolDefinition } from '@earendil-works/pi-coding-agent';
import { Type, type Static } from 'typebox';

import type { PythonExecutionResult } from '../../../shared/pythonRuntime';
import type { PythonRuntimeService } from '../../pythonRuntime/service';

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
  packages: Type.Array(Type.String({ maxLength: 200 }), { maxItems: 40 }),
  rebuild: Type.Optional(Type.Boolean()),
});

const formatResult = (result: PythonExecutionResult): PiPythonToolResult => {
  const text = JSON.stringify(result);
  if (result.exitCode !== 0) {
    throw new Error(text);
  }
  return {
    content: [{ type: 'text', text }],
    details: result,
    structuredContent: result,
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
      'Product interface python.execute: execute Python code in this workspace using its isolated managed Python environment. Returns stdout, stderr and exit code. This is local execution with user permissions, not a filesystem sandbox. Use python_install (python.install) for pinned packages.',
    promptSnippet:
      'Execute Python code in this workspace using its isolated managed Python environment.',
    promptGuidelines: [
      'Prefer `python_execute` to run Python code in the current workspace using its isolated managed Python environment.',
    ],
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
      'Product interface python.install: install exact pinned PyPI wheel packages (for example numpy==2.3.4) into this workspace only. Installation creates a new environment and switches only after success. Set rebuild=true only when the user explicitly asks to rebuild; existing environment directories are retained.',
    promptSnippet: 'Install exact pinned PyPI wheel packages into this workspace only.',
    promptGuidelines: [
      'Use `python_install` to atomically install exact pinned PyPI wheel packages (such as `numpy==2.3.4`) into this workspace.',
      'Set `rebuild=true` only when the user explicitly asks to rebuild; existing environment directories are retained.',
    ],
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
