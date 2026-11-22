/**
 * Official Feishu connector: managed lark-cli lifecycle (install, authorize,
 * verify, repair, uninstall) plus bundled connector skills. All Feishu CLI
 * subprocess traffic goes through runFeishuCliCommand with strict timeouts.
 */
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

import { app, shell } from 'electron';

import { applyApplicationRuntimeEnv } from '../libs/coworkUtil';
import { getFeishuCliRoot, getFeishuConnectorSkillsRoot } from '../libs/feishuConnectorPaths';
import { getFeishuCliLauncherPath, writeFeishuCliLauncher } from '../libs/feishuCliLauncher';
import { installDownloadedFeishuCli } from '../libs/feishuCliDownloader';
import { McpIntegrationRuntime } from '../libs/mcpIntegrationRuntime';
import { terminateProcessTree } from '../libs/ownedProcessStop';
import {
  OfficialIntegrationId,
  OfficialIntegrationManifests,
} from '../libs/mcpIntegrationManifest';

const FEISHU_CLI_TIMEOUT_MS = 120_000;
const FEISHU_CLI_AUTH_TIMEOUT_MS = 600_000;
export const FEISHU_MCP_REGISTRY_ID = OfficialIntegrationId.Feishu;
const getCurrentFeishuCliRoot = (): string => getFeishuCliRoot(app.getPath('userData'));

export const getLocalFeishuCliCommand = (): string | null => {
  const command = getFeishuCliLauncherPath(app.getPath('userData'));
  return fs.existsSync(command) ? command : null;
};

const decodeFeishuCliOutput = (chunks: Buffer[]): string => {
  const bytes = Buffer.concat(chunks);
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  if (!utf8.includes('\uFFFD')) return utf8;
  return new TextDecoder('gb18030', { fatal: false }).decode(bytes);
};

const runFeishuCliCommand = async (
  command: string,
  args: string[],
  cwd?: string,
  signal?: AbortSignal,
  timeoutMs = FEISHU_CLI_TIMEOUT_MS,
): Promise<string> => {
  signal?.throwIfAborted();
  const env: Record<string, string | undefined> = { ...process.env };
  // Keep the Agent process environment consistent with the app-managed
  // connector binary directory.
  await applyApplicationRuntimeEnv(env, { includePackageMirrors: true });
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      detached: process.platform !== 'win32',
      cwd,
      env,
    });
    const outputChunks: Buffer[] = [];
    let settled = false;
    const finish = () => {
      signal?.removeEventListener('abort', abort);
      clearTimeout(timer);
    };
    const cancel = (reason: Error) => {
      if (settled) return;
      settled = true;
      finish();
      void terminateProcessTree(child).then(
        () => reject(reason),
        error =>
          reject(new Error(`${reason.message}. Failed to stop the Feishu CLI.`, { cause: error })),
      );
    };
    const abort = () => cancel(new Error('MCP authorization was cancelled'));
    const timer = setTimeout(
      () => cancel(new Error(`Feishu CLI command timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
    signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', chunk =>
      outputChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)),
    );
    child.stderr.on('data', chunk =>
      outputChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)),
    );
    child.once('error', error => {
      if (settled) return;
      settled = true;
      finish();
      reject(error);
    });
    child.once('close', code => {
      if (settled) return;
      settled = true;
      finish();
      const output = decodeFeishuCliOutput(outputChunks).trim();
      if (code === 0) {
        resolve(output);
        return;
      }
      reject(new Error(output || `${command} exited with code ${code ?? 'unknown'}`));
    });
  });
};

const installFeishuCli = async (): Promise<void> => {
  await installDownloadedFeishuCli(app.getPath('userData'));
  await writeFeishuCliLauncher(app.getPath('userData'));
  // Pi's bash tool snapshots this process environment. Refresh the managed
  // PATH now so a connector installed after the first session is usable.
  await applyApplicationRuntimeEnv(process.env as Record<string, string | undefined>);
};

const verifyFeishuCli = async (command: string, signal?: AbortSignal): Promise<void> => {
  await runFeishuCliCommand(command, ['--version'], getCurrentFeishuCliRoot(), signal);
};

const prepareFeishuCli = async (signal?: AbortSignal): Promise<void> => {
  let cliCommand = getLocalFeishuCliCommand();
  const cliRoot = getCurrentFeishuCliRoot();
  await fs.promises.mkdir(cliRoot, { recursive: true });
  signal?.throwIfAborted();
  if (cliCommand) {
    try {
      await verifyFeishuCli(cliCommand, signal);
    } catch (error) {
      signal?.throwIfAborted();
      console.warn('[Feishu] CLI health check failed, reinstalling the pinned version:', error);
      cliCommand = null;
    }
  }
  if (!cliCommand) {
    await installFeishuCli();
    cliCommand = getLocalFeishuCliCommand();
    if (!cliCommand) throw new Error('Feishu CLI installation did not provide lark-cli');
    await verifyFeishuCli(cliCommand, signal);
  }

  try {
    await runFeishuCliCommand(cliCommand, ['config', 'show'], cliRoot, signal);
  } catch {
    await runFeishuCliCommand(
      cliCommand,
      ['config', 'init', '--new', '--lang', 'en'],
      cliRoot,
      signal,
    );
  }
};

const authorizeFeishuCli = async (signal?: AbortSignal): Promise<void> => {
  await prepareFeishuCli(signal);
  signal?.throwIfAborted();
  const cliCommand = getLocalFeishuCliCommand();
  if (!cliCommand) throw new Error('Feishu CLI installation did not provide lark-cli');
  const cliRoot = getCurrentFeishuCliRoot();

  const authOutput = await runFeishuCliCommand(
    cliCommand,
    ['auth', 'login', '--recommend', '--no-wait', '--json'],
    cliRoot,
    signal,
  );
  let authPayload: { device_code?: string; verification_url?: string } | null = null;
  for (const line of authOutput.trim().split(/\r?\n/).reverse()) {
    try {
      const parsed: unknown = JSON.parse(line);
      if (parsed && typeof parsed === 'object') {
        authPayload = parsed as { device_code?: string; verification_url?: string };
        break;
      }
    } catch {
      // The CLI may include human-readable notices around its JSON output.
    }
  }
  if (!authPayload?.device_code || !authPayload.verification_url) {
    throw new Error('Feishu CLI did not return a browser authorization URL');
  }
  signal?.throwIfAborted();
  await shell.openExternal(authPayload.verification_url);
  await runFeishuCliCommand(
    cliCommand,
    ['auth', 'login', '--device-code', authPayload.device_code, '--json'],
    cliRoot,
    signal,
    FEISHU_CLI_AUTH_TIMEOUT_MS,
  );
  await runFeishuCliCommand(cliCommand, ['auth', 'status'], cliRoot, signal);
};

const logoutFeishuCli = async (): Promise<void> => {
  const cliCommand = getLocalFeishuCliCommand();
  if (!cliCommand) return;

  await runFeishuCliCommand(cliCommand, ['auth', 'logout'], getCurrentFeishuCliRoot());
  console.log('[Feishu] official CLI authorization removed');
};

const resolveBundledFeishuSkills = (): string | null => {
  const candidates = [
    path.join(process.resourcesPath, 'MCPs', 'feishu', 'skills'),
    path.join(app.getAppPath(), 'MCPs', 'feishu', 'skills'),
    path.join(process.cwd(), 'MCPs', 'feishu', 'skills'),
  ];
  return candidates.find(candidate => fs.existsSync(candidate)) || null;
};

const installFeishuSkills = async (): Promise<void> => {
  const source = resolveBundledFeishuSkills();
  if (!source) throw new Error('Bundled Feishu skills were not found');
  // Keep connector-provided skills in the per-user directory. This avoids
  // mutating the checked-out development SKILLs tree while still letting the
  // Agent load them through its user extraDirs configuration.
  const target = getFeishuConnectorSkillsRoot(app.getPath('userData'));
  await fs.promises.mkdir(target, { recursive: true });
  const entries = await fs.promises.readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    await fs.promises.cp(path.join(source, entry.name), path.join(target, entry.name), {
      recursive: true,
      force: true,
    });
  }
  console.log('[Feishu] official CLI skills installed for the Agent');
};

const removeFeishuSkills = async (): Promise<void> => {
  const target = getFeishuConnectorSkillsRoot(app.getPath('userData'));
  await fs.promises.rm(target, { recursive: true, force: true });
  console.log('[Feishu] official CLI skills removed from the Agent');
};

const verifyFeishuConnector = async (signal?: AbortSignal): Promise<void> => {
  const cliCommand = getLocalFeishuCliCommand();
  if (!cliCommand) throw new Error('Feishu CLI is not installed.');
  const cliRoot = getCurrentFeishuCliRoot();
  await verifyFeishuCli(cliCommand, signal);
  await runFeishuCliCommand(cliCommand, ['auth', 'status'], cliRoot, signal);
};

const repairFeishuConnector = async (): Promise<void> => {
  const cliRoot = getCurrentFeishuCliRoot();
  await fs.promises.mkdir(cliRoot, { recursive: true });
  await installFeishuCli();
  await prepareFeishuCli();
};

let integrationRuntime: McpIntegrationRuntime | undefined;

export const getMcpIntegrationRuntime = (): McpIntegrationRuntime => {
  if (integrationRuntime) return integrationRuntime;
  const runtime = new McpIntegrationRuntime();
  runtime.register({
    manifest: OfficialIntegrationManifests[OfficialIntegrationId.Feishu],
    provision: prepareFeishuCli,
    authenticate: async signal => {
      await authorizeFeishuCli(signal);
      signal?.throwIfAborted();
      await installFeishuSkills();
    },
    verify: signal => verifyFeishuConnector(signal),
    repair: () => repairFeishuConnector(),
    uninstall: async () => {
      try {
        await logoutFeishuCli();
      } finally {
        await removeFeishuSkills();
      }
    },
  });
  integrationRuntime = runtime;
  return runtime;
};
