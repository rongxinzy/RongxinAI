import {
  runManagedSkillScript,
  startManagedSkillProcess,
  type ManagedSkillProcess,
} from '../skillRuntimeRunner';

export const PiCadViewerToolName = 'start_cad_viewer';
const CadViewerSkillId = 'text-to-cad';
const CadViewerRuntimeSkillId = 'cad-viewer';
const CadRuntimeBootstrapScript = 'scripts/bootstrap.py';
const CadViewerScript = 'scripts/viewer/server_py/start_viewer.py';
const CadViewerHost = '127.0.0.1';
const CadViewerPort = 3245;
const CadViewerReadyTimeoutMs = 30_000;

type CadViewerStart = {
  workspaceRoot: string;
  skillRoot: string;
  signal?: AbortSignal;
};

type CadViewerReady = { url: string; output: string; pid: number | null };

export class PiCadViewerService {
  private process: ManagedSkillProcess | null = null;
  private workspaceRoot: string | null = null;
  private skillRoot: string | null = null;
  private starting?: { abort: AbortController; result: Promise<CadViewerReady> };
  private stopping?: Promise<void>;
  private closed = false;

  async start(options: CadViewerStart): Promise<CadViewerReady> {
    if (this.closed) throw new Error('The CAD viewer is shutting down.');
    options.signal?.throwIfAborted();
    if (this.stopping) {
      await this.stopping;
      return this.start(options);
    }
    if (this.starting) {
      await this.starting.result;
      return this.start(options);
    }
    if (
      this.process?.isRunning() &&
      this.workspaceRoot === options.workspaceRoot &&
      this.skillRoot === options.skillRoot
    ) {
      return {
        url: `http://${CadViewerHost}:${CadViewerPort}`,
        output: 'The CAD viewer is already running and was reused.',
        pid: this.process.pid,
      };
    }
    if (this.process) {
      await this.stop();
      return this.start(options);
    }

    const abort = new AbortController();
    const signal = options.signal ? AbortSignal.any([abort.signal, options.signal]) : abort.signal;
    const result = this.startViewer({ ...options, signal }).finally(() => {
      this.starting = undefined;
    });
    this.starting = { abort, result };
    return result;
  }

  private async startViewer(options: CadViewerStart): Promise<CadViewerReady> {
    const bootstrap = await runManagedSkillScript({
      skillId: CadViewerSkillId,
      script: CadRuntimeBootstrapScript,
      args: ['--json'],
      workspaceRoot: options.workspaceRoot,
      skillsRoot: options.skillRoot,
      signal: options.signal,
    });
    options.signal?.throwIfAborted();
    if (!bootstrap.ok) {
      throw new Error(
        `CAD runtime bootstrap failed [${bootstrap.errorCode || 'SKILL_SCRIPT_FAILED'}]: ${bootstrap.error || bootstrap.stderr}`,
      );
    }
    let runtimeRoot: string | null = null;
    for (const line of bootstrap.stdout.split(/\r?\n/).reverse()) {
      try {
        const parsed = JSON.parse(line) as { root?: unknown };
        if (typeof parsed.root === 'string' && parsed.root.trim()) {
          runtimeRoot = parsed.root.trim();
          break;
        }
      } catch {
        // Bootstrap may emit diagnostic lines before its JSON result.
      }
    }
    if (!runtimeRoot) throw new Error('CAD runtime bootstrap did not return a runtime root.');

    const processHandle = await startManagedSkillProcess({
      skillId: CadViewerRuntimeSkillId,
      script: CadViewerScript,
      args: ['--host', CadViewerHost, '--json'],
      workspaceRoot: options.workspaceRoot,
      skillsRoot: runtimeRoot,
      signal: options.signal,
    });
    this.process = processHandle;
    try {
      options.signal?.throwIfAborted();
      const ready = await processHandle.waitForOutput(
        (stdout, stderr) => /(?:3245|listening|ready)/i.test(`${stdout}\n${stderr}`),
        CadViewerReadyTimeoutMs,
      );
      options.signal?.throwIfAborted();
      this.workspaceRoot = options.workspaceRoot;
      this.skillRoot = options.skillRoot;
      return {
        url: `http://${CadViewerHost}:${CadViewerPort}`,
        output: [ready.stdout, ready.stderr].filter(Boolean).join('\n'),
        pid: processHandle.pid,
      };
    } catch (error) {
      await processHandle.stop();
      if (this.process === processHandle) this.process = null;
      throw error;
    }
  }

  stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    const starting = this.starting;
    const process = this.process;
    if (!starting && !process) return Promise.resolve();
    starting?.abort.abort();
    const stopping = Promise.all([
      process?.stop(),
      starting?.result.catch((): undefined => undefined),
    ])
      .then(async () => {
        // Startup may have acquired its process while cancellation was draining.
        const lateProcess = this.process;
        if (lateProcess && lateProcess !== process) await lateProcess.stop();
        this.process = null;
      })
      .finally(() => {
        this.stopping = undefined;
      });
    this.stopping = stopping;
    return stopping;
  }

  shutdown(): Promise<void> {
    this.closed = true;
    return this.stop();
  }
}

type CadViewerToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  details: Record<string, unknown>;
};

export function buildPiCadViewerTool(options: {
  workspaceRoot: string;
  skillRoot: string;
  service: PiCadViewerService;
}): Record<string, unknown> {
  return {
    name: PiCadViewerToolName,
    label: 'Start CAD Viewer',
    description:
      'Start or reuse the managed local CAD viewer. The viewer is kept alive by the application; do not start its server through run_skill_script.',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    execute: async (
      _toolCallId: string,
      _params: Record<string, unknown>,
      signal?: AbortSignal,
    ): Promise<CadViewerToolResult> => {
      const result = await options.service.start({
        workspaceRoot: options.workspaceRoot,
        skillRoot: options.skillRoot,
        signal,
      });
      return {
        content: [
          {
            type: 'text',
            text: `CAD viewer is ready at ${result.url}.\n${result.output}`.trim(),
          },
        ],
        details: { url: result.url, pid: result.pid },
      };
    },
  };
}
