/**
 * Official Feishu connector: managed lark-cli lifecycle (install, authorize,
 * verify, repair, uninstall) plus bundled connector skills. All Feishu CLI
 * subprocess traffic goes through runFeishuCliCommand with strict timeouts.
 */
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

import { app, shell } from 'electron';

import { rt } from './runtimeState';
import { applyApplicationRuntimeEnv } from '../libs/coworkUtil';
import { getFeishuCliRoot, getFeishuConnectorSkillsRoot } from '../libs/feishuConnectorPaths';
import { getFeishuCliLauncherPath, writeFeishuCliLauncher } from '../libs/feishuCliLauncher';
import { installDownloadedFeishuCli } from '../libs/feishuCliDownloader';
import { McpIntegrationRuntime } from '../libs/mcpIntegrationRuntime';
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

const runFeishuCliCommand = (
  command: string,
  args: string[],
  cwd?: string,
  timeoutMs = FEISHU_CLI_TIMEOUT_MS,
  signal?: AbortSignal,
): Promise<string> =>
  new Promise((resolve, reject) => {
    const env: Record<string, string | undefined> = { ...process.env };
    // Keep the Agent process environment consistent with the app-managed
    // connector binary directory.
    applyApplicationRuntimeEnv(env, { includePackageMirrors: true });
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      cwd,
      shell: process.platform === 'win32' && command.toLowerCase().endsWith('.cmd'),
      env,
    });
    const outputChunks: Buffer[] = [];
    let settled = false;
    let timer: NodeJS.Timeout | null = null;
    const abort = () => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      child.kill();
      reject(new Error('MCP authorization was cancelled'));
    };
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener('abort', abort, { once: true });
    const finish = () => signal?.removeEventListener('abort', abort);
    timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      finish();
      child.kill();
      reject(new Error(`Feishu CLI command timed out after ${timeoutMs}ms`));
    }, timeoutMs);
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
      if (timer) clearTimeout(timer);
      reject(error);
    });
    child.once('close', code => {
      if (settled) return;
      settled = true;
      finish();
      if (timer) clearTimeout(timer);
      const output = decodeFeishuCliOutput(outputChunks).trim();
      if (code === 0) {
        resolve(output);
        return;
      }
      reject(new Error(output || `${command} exited with code ${code ?? 'unknown'}`));
    });
  });

const findFeishuCliCommand = async (): Promise<string | null> => {
  return getLocalFeishuCliCommand();
};

const installFeishuCli = async (): Promise<void> => {
  await installDownloadedFeishuCli(app.getPath('userData'));
  await writeFeishuCliLauncher(app.getPath('userData'));
  // Pi's bash tool snapshots this process environment. Refresh the managed
  // PATH now so a connector installed after the first session is usable.
  applyApplicationRuntimeEnv(process.env as Record<string, string | undefined>);
};

const verifyFeishuCli = async (command: string): Promise<void> => {
  await runFeishuCliCommand(command, ['--version'], getCurrentFeishuCliRoot());
};

const prepareFeishuCli = async (): Promise<void> => {
  let cliCommand = await findFeishuCliCommand();
  const cliRoot = getCurrentFeishuCliRoot();
  await fs.promises.mkdir(cliRoot, { recursive: true });
  if (cliCommand) {
    try {
      await verifyFeishuCli(cliCommand);
    } catch (error) {
      console.warn('[Feishu] CLI health check failed, reinstalling the pinned version:', error);
      await installFeishuCli();
      cliCommand = await findFeishuCliCommand();
    }
  } else {
    await installFeishuCli();
    cliCommand = await findFeishuCliCommand();
  }
  if (!cliCommand) throw new Error('Feishu CLI installation did not provide lark-cli');
  await verifyFeishuCli(cliCommand);

  try {
    await runFeishuCliCommand(cliCommand, ['config', 'show'], cliRoot);
  } catch {
    await runFeishuCliCommand(cliCommand, ['config', 'init', '--new', '--lang', 'en'], cliRoot);
  }
};

const authorizeFeishuCli = async (signal?: AbortSignal): Promise<void> => {
  await prepareFeishuCli();
  const cliCommand = await findFeishuCliCommand();
  if (!cliCommand) throw new Error('Feishu CLI installation did not provide lark-cli');
  const cliRoot = getCurrentFeishuCliRoot();

  const authOutput = await runFeishuCliCommand(
    cliCommand,
    ['auth', 'login', '--recommend', '--no-wait', '--json'],
    cliRoot,
    FEISHU_CLI_TIMEOUT_MS,
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
  await shell.openExternal(authPayload.verification_url);
  await runFeishuCliCommand(
    cliCommand,
    ['auth', 'login', '--device-code', authPayload.device_code, '--json'],
    cliRoot,
    FEISHU_CLI_AUTH_TIMEOUT_MS,
    signal,
  );
  await runFeishuCliCommand(cliCommand, ['auth', 'status'], cliRoot, FEISHU_CLI_TIMEOUT_MS, signal);
};

const logoutFeishuCli = async (): Promise<void> => {
  const cliCommand = await findFeishuCliCommand();
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

export const verifyFeishuConnector = async (signal?: AbortSignal): Promise<void> => {
  const cliCommand = await findFeishuCliCommand();
  if (!cliCommand) throw new Error('Feishu CLI is not installed.');
  const cliRoot = getCurrentFeishuCliRoot();
  await verifyFeishuCli(cliCommand);
  await runFeishuCliCommand(cliCommand, ['auth', 'status'], cliRoot, FEISHU_CLI_TIMEOUT_MS, signal);
};

const repairFeishuConnector = async (): Promise<void> => {
  const cliRoot = getCurrentFeishuCliRoot();
  await fs.promises.mkdir(cliRoot, { recursive: true });
  await installFeishuCli();
  await prepareFeishuCli();
};

export const getMcpIntegrationRuntime = (): McpIntegrationRuntime => {
  if (rt.mcpIntegrationRuntime) return rt.mcpIntegrationRuntime;
  const runtime = new McpIntegrationRuntime();
  runtime.register({
    manifest: OfficialIntegrationManifests[OfficialIntegrationId.Feishu],
    provision: () => prepareFeishuCli(),
    authenticate: async signal => {
      await authorizeFeishuCli(signal);
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
  rt.mcpIntegrationRuntime = runtime;
  return runtime;
};
