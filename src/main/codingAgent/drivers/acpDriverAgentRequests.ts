import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';

import { CodingErrorMessage, CodingEventKind } from '../../../shared/codingAgent';
import { AcpErrorCode, AcpMethod, AcpRequestError } from '../acp/protocol';
import { TerminalBroker } from '../terminalBroker';
import { WorkspaceBroker } from '../workspaceBroker';

/**
 * Publishes a tool-driven transcript event (file change, terminal) back into
 * the driver event stream of the session that triggered it.
 */
export type AcpToolEventPublisher = (
  sessionId: unknown,
  kind: CodingEventKind,
  payload: Record<string, unknown>,
) => void;

/**
 * Serves agent-initiated ACP requests — filesystem reads/writes and terminal
 * lifecycle — inside the lane workspace. Paths resolve through the
 * WorkspaceBroker and terminals run through the TerminalBroker with the
 * driver's launch environment.
 */
export class AcpAgentRequestBroker {
  private readonly terminalBroker = new TerminalBroker();
  private workspaceRoot = '';
  private workspaceBroker: WorkspaceBroker | null = null;

  constructor(
    private readonly launchEnvironment: Record<string, string | undefined>,
    private readonly publishToolEvent: AcpToolEventPublisher,
  ) {}

  /** Re-binds the workspace the agent may read, write, and spawn terminals in. */
  setWorkspace(workspaceRoot: string): void {
    this.workspaceRoot = workspaceRoot;
    this.workspaceBroker = new WorkspaceBroker(workspaceRoot);
  }

  async handle(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (method === AcpMethod.FsReadTextFile) return await this.readWorkspaceFile(params);
    if (method === AcpMethod.FsWriteTextFile) return await this.writeWorkspaceFile(params);
    if (method === AcpMethod.TerminalCreate) return await this.createTerminal(params);
    if (method === AcpMethod.TerminalOutput) return this.getTerminalOutput(params);
    if (method === AcpMethod.TerminalWaitForExit) return await this.waitForTerminal(params);
    if (method === AcpMethod.TerminalKill) return this.killTerminal(params);
    if (method === AcpMethod.TerminalRelease) return this.releaseTerminal(params);
    throw new AcpRequestError(
      AcpErrorCode.MethodNotFound,
      `Unsupported ACP agent request: ${method}.`,
    );
  }

  dispose(): void {
    this.terminalBroker.dispose();
  }

  private async readWorkspaceFile(
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const target = await this.resolveWorkspacePath(params.path);
    const content = await readFile(target, 'utf8').catch(error => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new AcpRequestError(AcpErrorCode.ResourceNotFound, `File not found: ${target}.`);
      }
      throw error;
    });
    this.publishToolEvent(params.sessionId, CodingEventKind.FileChange, {
      action: 'read',
      path: target,
    });
    const line =
      typeof params.line === 'number' && Number.isInteger(params.line) && params.line > 0
        ? params.line
        : 1;
    const limit =
      typeof params.limit === 'number' && Number.isInteger(params.limit) && params.limit > 0
        ? params.limit
        : undefined;
    if (line === 1 && limit === undefined) return { content };
    const lines = content.split(/\r?\n/);
    return {
      content: lines.slice(line - 1, limit === undefined ? undefined : line - 1 + limit).join('\n'),
    };
  }

  private async writeWorkspaceFile(
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    if (typeof params.content !== 'string') {
      throw new AcpRequestError(
        AcpErrorCode.InvalidParams,
        CodingErrorMessage.AcpFileWriteNoContent,
      );
    }
    const target = await this.resolveWorkspacePath(params.path);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, params.content, 'utf8');
    this.publishToolEvent(params.sessionId, CodingEventKind.FileChange, {
      action: 'write',
      path: target,
    });
    return {};
  }

  private async createTerminal(params: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (typeof params.command !== 'string' || !params.command) {
      throw new AcpRequestError(
        AcpErrorCode.InvalidParams,
        CodingErrorMessage.AcpTerminalNoCommand,
      );
    }
    const cwd = await this.resolveWorkspacePath(
      typeof params.cwd === 'string' ? params.cwd : this.workspaceRoot,
    );
    const args = Array.isArray(params.args)
      ? params.args.filter((arg): arg is string => typeof arg === 'string')
      : [];
    const environment = this.terminalEnvironment(params.env);
    const outputByteLimit =
      typeof params.outputByteLimit === 'number' && Number.isSafeInteger(params.outputByteLimit)
        ? params.outputByteLimit
        : undefined;
    const terminal = this.terminalBroker.start({
      command: params.command,
      args,
      cwd,
      env: environment,
      outputByteLimit,
    });
    this.publishToolEvent(params.sessionId, CodingEventKind.Terminal, {
      terminalId: terminal.id,
      command: params.command,
      args,
      cwd,
    });
    return { terminalId: terminal.id };
  }

  private getTerminalOutput(params: Record<string, unknown>): Record<string, unknown> {
    const terminal = this.requireTerminal(params.terminalId);
    return this.toTerminalOutput(terminal);
  }

  private async waitForTerminal(params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const terminal = await this.terminalBroker.wait(this.requireTerminalId(params.terminalId));
    return { exitCode: terminal.exitCode, signal: terminal.signal };
  }

  private killTerminal(params: Record<string, unknown>): Record<string, unknown> {
    this.terminalBroker.kill(this.requireTerminalId(params.terminalId));
    return {};
  }

  private releaseTerminal(params: Record<string, unknown>): Record<string, unknown> {
    this.terminalBroker.release(this.requireTerminalId(params.terminalId));
    return {};
  }

  private async resolveWorkspacePath(value: unknown): Promise<string> {
    if (typeof value !== 'string' || !value) {
      throw new AcpRequestError(AcpErrorCode.InvalidParams, CodingErrorMessage.AcpFilesystemNoPath);
    }
    if (!this.workspaceBroker) throw new Error(CodingErrorMessage.AcpWorkspaceBrokerMissing);
    try {
      return await this.workspaceBroker.resolveTarget(value);
    } catch (error) {
      throw new AcpRequestError(
        AcpErrorCode.InvalidParams,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private terminalEnvironment(value: unknown): Record<string, string> {
    const environment = Object.fromEntries(
      Object.entries(this.launchEnvironment).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    );
    if (!Array.isArray(value)) return environment;
    for (const variable of value) {
      if (!variable || typeof variable !== 'object') continue;
      const { name, value: variableValue } = variable as { name?: unknown; value?: unknown };
      if (
        typeof name === 'string' &&
        /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) &&
        typeof variableValue === 'string'
      ) {
        environment[name] = variableValue;
      }
    }
    return environment;
  }

  private requireTerminalId(value: unknown): string {
    if (typeof value !== 'string' || !value) {
      throw new AcpRequestError(AcpErrorCode.InvalidParams, CodingErrorMessage.AcpTerminalNoId);
    }
    return value;
  }

  private requireTerminal(value: unknown) {
    const terminal = this.terminalBroker.output(this.requireTerminalId(value));
    if (!terminal) {
      throw new AcpRequestError(AcpErrorCode.ResourceNotFound, CodingErrorMessage.AcpTerminalGone);
    }
    return terminal;
  }

  private toTerminalOutput(terminal: {
    output: string;
    truncated: boolean;
    exitCode: number | null;
    signal: NodeJS.Signals | null;
  }): Record<string, unknown> {
    return {
      output: terminal.output,
      truncated: terminal.truncated,
      exitStatus:
        terminal.exitCode !== null || terminal.signal !== null
          ? { exitCode: terminal.exitCode, signal: terminal.signal }
          : null,
    };
  }
}
