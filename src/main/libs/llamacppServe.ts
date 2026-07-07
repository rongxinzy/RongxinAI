import { execFile } from 'child_process';
import { promisify } from 'util';

import type {
  LlamaCppRuntimeBackend as LlamaCppRuntimeBackendType,
  LlamaCppRuntimeCapabilities,
  LlamaCppRuntimeDevice,
  LlamaCppRuntimeListDevicesResult,
  LlamaCppServiceConfig,
} from '../../shared/llamacpp';
import {
  LlamaCppRuntimeBackend,
  LlamaCppServiceConfigFieldKey,
} from '../../shared/llamacpp';
import {
  prependEnvPathEntry,
  resolveExecutableDir,
  resolveLlamaCppRuntimeMetadata,
} from './llamacppRuntimePaths';

const execFileAsync = promisify(execFile);
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = '8080';
const LLAMACPP_HELP_PROBE_TIMEOUT_MS = 10_000;

type ExecFileRunner = (
  file: string,
  args: string[],
  options: {
    env: NodeJS.ProcessEnv;
    encoding: 'utf8';
    maxBuffer: number;
    timeout: number;
    windowsHide: boolean;
  },
) => Promise<{ stdout: string; stderr: string }>;

export function buildLlamaServerArgs(
  config: LlamaCppServiceConfig,
  modelsDir: string,
  presetPath: string,
): string[] {
  const args = [
    '--host',
    config.listenHost?.trim() || config.host?.trim() || DEFAULT_HOST,
    '--port',
    config.port?.trim() || DEFAULT_PORT,
    '--models-dir',
    modelsDir,
    '--models-preset',
    presetPath,
    '--props',
    '--slots',
    '--no-ui',
  ];
  appendArg(args, '--models-max', config.modelsMax);
  if (typeof config.modelsAutoload === 'boolean') {
    args.push(
      config.modelsAutoload && shouldEnableLlamaCppModelsAutoload(config.modelsMax)
        ? '--models-autoload'
        : '--no-models-autoload',
    );
  }
  appendArg(args, '--timeout', config.timeout);
  appendArg(args, '--threads-http', config.threadsHttp);
  appendArg(args, '--cache-reuse', config.cacheReuse);
  appendArg(args, '--cache-ram', config.cacheRam);
  appendArg(args, '--ctx-checkpoints', config.ctxCheckpoints);
  appendArg(args, '--checkpoint-every-n-tokens', config.checkpointEveryNt);
  if (typeof config.cachePrompt === 'boolean') {
    args.push(config.cachePrompt ? '--cache-prompt' : '--no-cache-prompt');
  }
  appendArg(args, '--ctx-size', config.ctxSize);
  appendArg(args, '--parallel', config.parallel);
  appendArg(args, '--batch-size', config.batchSize);
  appendArg(args, '--ubatch-size', config.ubatchSize);
  appendArg(args, '--gpu-layers', config.gpuLayers);
  appendArg(args, '--threads', config.threads);
  appendArg(args, '--threads-batch', config.threadsBatch);
  appendArg(args, '--device', config.device);
  appendArg(args, '--main-gpu', config.mainGpu);
  appendArg(args, '--split-mode', config.splitMode);
  appendArg(args, '--tensor-split', config.tensorSplit);
  appendArg(args, '--flash-attn', config.flashAttn);
  if (config.jinja === 'on') args.push('--jinja');
  if (config.jinja === 'off') args.push('--no-jinja');
  appendArg(args, '--reasoning', config.reasoning);
  if (config.reasoningFormat && config.reasoningFormat !== 'auto') {
    appendArg(args, '--reasoning-format', config.reasoningFormat);
  }
  appendArg(args, '--reasoning-budget', config.reasoningBudget);
  appendArg(args, '--reasoning-budget-message', config.reasoningBudgetMessage);
  appendArg(args, '--chat-template', config.chatTemplate);
  appendArg(args, '--chat-template-file', config.chatTemplateFile);
  if (typeof config.skipChatParsing === 'boolean') {
    args.push(config.skipChatParsing ? '--skip-chat-parsing' : '--no-skip-chat-parsing');
  }
  if (typeof config.prefillAssistant === 'boolean') {
    args.push(config.prefillAssistant ? '--prefill-assistant' : '--no-prefill-assistant');
  }
  if (config.noMmap) args.push('--no-mmap');
  if (config.mlock) args.push('--mlock');
  return args;
}

export function filterLlamaCppServiceConfigByRuntimeCapabilities(
  config: LlamaCppServiceConfig,
  runtimeCapabilities: LlamaCppRuntimeCapabilities | null | undefined,
): LlamaCppServiceConfig {
  if (!runtimeCapabilities) return config;

  const next: LlamaCppServiceConfig = { ...config };
  const supports = runtimeCapabilities.supports ?? {};
  const clearWhenUnsupported = (
    key: keyof LlamaCppServiceConfig,
    supportKey: LlamaCppServiceConfigFieldKey,
  ) => {
    if (supports[supportKey] === false) {
      delete next[key];
    }
  };

  clearWhenUnsupported('modelsMax', LlamaCppServiceConfigFieldKey.ModelsMax);
  clearWhenUnsupported('modelsAutoload', LlamaCppServiceConfigFieldKey.ModelsAutoload);
  clearWhenUnsupported('timeout', LlamaCppServiceConfigFieldKey.Timeout);
  clearWhenUnsupported('threadsHttp', LlamaCppServiceConfigFieldKey.ThreadsHttp);
  clearWhenUnsupported('parallel', LlamaCppServiceConfigFieldKey.Parallel);
  clearWhenUnsupported('cachePrompt', LlamaCppServiceConfigFieldKey.CachePrompt);
  clearWhenUnsupported('cacheReuse', LlamaCppServiceConfigFieldKey.CacheReuse);
  clearWhenUnsupported('cacheRam', LlamaCppServiceConfigFieldKey.CacheRam);
  clearWhenUnsupported('device', LlamaCppServiceConfigFieldKey.Device);
  clearWhenUnsupported('splitMode', LlamaCppServiceConfigFieldKey.SplitMode);
  clearWhenUnsupported('tensorSplit', LlamaCppServiceConfigFieldKey.TensorSplit);
  clearWhenUnsupported('mainGpu', LlamaCppServiceConfigFieldKey.MainGpu);
  clearWhenUnsupported('flashAttn', LlamaCppServiceConfigFieldKey.FlashAttn);
  clearWhenUnsupported('jinja', LlamaCppServiceConfigFieldKey.Jinja);
  clearWhenUnsupported('mlock', LlamaCppServiceConfigFieldKey.Mlock);

  if (next.cachePrompt === false) {
    delete next.cacheReuse;
    delete next.cacheRam;
  }
  if (next.splitMode !== 'tensor') {
    delete next.tensorSplit;
  }
  if (runtimeCapabilities.deviceProbeSucceeded && runtimeCapabilities.gpuDeviceCount <= 1) {
    delete next.device;
    delete next.splitMode;
    delete next.tensorSplit;
    delete next.mainGpu;
  }

  return next;
}

export function shouldEnableLlamaCppModelsAutoload(modelsMax: string | undefined): boolean {
  return normalizePositiveInteger(modelsMax) === 1;
}

export function buildLlamaCppServeEnv(
  baseEnv: NodeJS.ProcessEnv,
  executablePath: string,
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv {
  const env = { ...baseEnv };
  const runtimeBinDir = resolveExecutableDir(executablePath, platform);
  if (!runtimeBinDir) return env;

  if (platform === 'win32') {
    prependEnvPathEntry(env, 'PATH', runtimeBinDir, platform);
    return env;
  }
  if (platform === 'linux') {
    prependEnvPathEntry(env, 'LD_LIBRARY_PATH', runtimeBinDir, platform);
  }
  return env;
}

export async function listLlamaCppRuntimeHelpFlags(input: {
  executablePath: string;
  platform: NodeJS.Platform;
  baseEnv?: NodeJS.ProcessEnv;
  runner?: ExecFileRunner;
}): Promise<{
  success: boolean;
  flags: string[];
  rawOutput?: string;
  error?: string;
}> {
  const runner = input.runner ?? (execFileAsync as ExecFileRunner);
  try {
    const { stdout, stderr } = await runner(input.executablePath, ['--help'], {
      env: buildLlamaCppServeEnv(input.baseEnv ?? process.env, input.executablePath, input.platform),
      encoding: 'utf8',
      maxBuffer: 512 * 1024,
      timeout: LLAMACPP_HELP_PROBE_TIMEOUT_MS,
      windowsHide: true,
    });
    const rawOutput = [stdout, stderr].filter(Boolean).join(stderr ? '\n' : '');
    return {
      success: true,
      flags: parseLlamaCppHelpFlags(rawOutput),
      rawOutput,
    };
  } catch (error) {
    return {
      success: false,
      flags: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function parseLlamaCppHelpFlags(output: string): string[] {
  const flags = new Set<string>();
  for (const line of output.split(/\r?\n/)) {
    const matches = line.match(/--[a-z0-9][a-z0-9-]*/gi);
    if (!matches) continue;
    matches.forEach(flag => flags.add(flag.toLowerCase()));
  }
  return Array.from(flags).sort();
}

export async function listLlamaCppRuntimeDevices(input: {
  executablePath: string;
  platform: NodeJS.Platform;
  baseEnv?: NodeJS.ProcessEnv;
  runner?: ExecFileRunner;
}): Promise<LlamaCppRuntimeListDevicesResult> {
  const runner = input.runner ?? (execFileAsync as ExecFileRunner);
  const metadata = resolveLlamaCppRuntimeMetadata(input.executablePath);
  try {
    const { stdout, stderr } = await runner(input.executablePath, ['--list-devices'], {
      env: buildLlamaCppServeEnv(input.baseEnv ?? process.env, input.executablePath, input.platform),
      encoding: 'utf8',
      maxBuffer: 256 * 1024,
      timeout: 10_000,
      windowsHide: true,
    });
    const rawOutput = [stdout, stderr].filter(Boolean).join(stderr ? '\n' : '');
    return {
      success: true,
      executablePath: input.executablePath,
      runtimeTargetId: metadata.runtimeTargetId,
      rawOutput,
      devices: parseLlamaCppListDevicesOutput(rawOutput),
    };
  } catch (error) {
    return {
      success: false,
      executablePath: input.executablePath,
      runtimeTargetId: metadata.runtimeTargetId,
      devices: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function parseLlamaCppListDevicesOutput(output: string): LlamaCppRuntimeDevice[] {
  const devices: LlamaCppRuntimeDevice[] = [];
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || /^available devices:?$/i.test(trimmed)) continue;
    const match = trimmed.match(/^([A-Za-z]+[\w.-]*)\s*:\s*(.+)$/);
    if (!match) continue;
    const id = match[1].trim();
    if (id.toUpperCase() !== 'CPU' && !/\d+$/.test(id)) continue;
    const rawName = match[2].replace(/\s*\([^)]*\)\s*$/, '').trim();
    const backend = inferLlamaCppDeviceBackend(id, rawName);
    devices.push({
      id,
      name: rawName || id,
      backend,
    });
  }
  return devices;
}

export function resolveLlamaCppDeviceSelection(
  rawValue: string,
  devices: LlamaCppRuntimeDevice[],
): string {
  const trimmed = rawValue.trim();
  if (!trimmed) return trimmed;
  const parts = trimmed.split(',').map(part => part.trim()).filter(Boolean);
  if (parts.length === 0) return '';
  if (!parts.every(part => /^\d+$/.test(part))) {
    return parts.every(part => devices.some(device => device.id === part || device.name === part))
      ? parts.join(',')
      : '';
  }

  const resolved = parts.map(part => {
    const index = Number.parseInt(part, 10);
    const device = devices[index];
    return device?.id;
  });
  if (resolved.some(part => !part)) return '';
  return resolved.join(',');
}

export function buildLlamaCppServiceConfigFieldSupport(input: {
  helpProbeSucceeded: boolean;
  flags: string[];
  devices: LlamaCppRuntimeDevice[];
  runtimeBackend?: LlamaCppRuntimeBackendType;
}): Partial<Record<LlamaCppServiceConfigFieldKey, boolean>> {
  const flags = new Set(input.flags.map(flag => flag.toLowerCase()));
  const gpuDevices = input.devices.filter(device => isGpuLikeRuntimeDevice(device));
  const hasGpu = gpuDevices.length > 0 || input.runtimeBackend === LlamaCppRuntimeBackend.Cuda;
  const hasMultiGpu = gpuDevices.length > 1;
  const hasFlag = (...names: string[]) => names.some(name => flags.has(name.toLowerCase()));
  const unknownHelpSupport = !input.helpProbeSucceeded;

  return {
    [LlamaCppServiceConfigFieldKey.ModelsMax]: unknownHelpSupport || hasFlag('--models-max'),
    [LlamaCppServiceConfigFieldKey.ModelsAutoload]:
      unknownHelpSupport || hasFlag('--models-autoload', '--no-models-autoload'),
    [LlamaCppServiceConfigFieldKey.Timeout]: unknownHelpSupport || hasFlag('--timeout'),
    [LlamaCppServiceConfigFieldKey.ThreadsHttp]: unknownHelpSupport || hasFlag('--threads-http'),
    [LlamaCppServiceConfigFieldKey.Parallel]: unknownHelpSupport || hasFlag('--parallel'),
    [LlamaCppServiceConfigFieldKey.CachePrompt]:
      unknownHelpSupport || hasFlag('--cache-prompt', '--no-cache-prompt'),
    [LlamaCppServiceConfigFieldKey.CacheReuse]: unknownHelpSupport || hasFlag('--cache-reuse'),
    [LlamaCppServiceConfigFieldKey.CacheRam]: unknownHelpSupport || hasFlag('--cache-ram'),
    [LlamaCppServiceConfigFieldKey.Device]:
      hasGpu && (unknownHelpSupport || hasFlag('--device')),
    [LlamaCppServiceConfigFieldKey.SplitMode]:
      hasMultiGpu && (unknownHelpSupport || hasFlag('--split-mode')),
    [LlamaCppServiceConfigFieldKey.TensorSplit]:
      hasMultiGpu && (unknownHelpSupport || hasFlag('--tensor-split')),
    [LlamaCppServiceConfigFieldKey.MainGpu]:
      hasMultiGpu && (unknownHelpSupport || hasFlag('--main-gpu')),
    [LlamaCppServiceConfigFieldKey.FlashAttn]:
      hasGpu && (unknownHelpSupport || hasFlag('--flash-attn')),
    [LlamaCppServiceConfigFieldKey.Jinja]: unknownHelpSupport || hasFlag('--jinja', '--no-jinja'),
    [LlamaCppServiceConfigFieldKey.Mlock]: unknownHelpSupport || hasFlag('--mlock'),
  };
}

function appendArg(args: string[], name: string, value: string | undefined): void {
  const trimmed = value?.trim();
  if (!trimmed) return;
  args.push(name, trimmed);
}

function normalizePositiveInteger(value: string | undefined): number | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function inferLlamaCppDeviceBackend(id: string, name: string): string {
  const source = `${id} ${name}`.toLowerCase();
  if (source.includes('cuda')) return 'cuda';
  if (source.includes('metal')) return 'metal';
  if (source.includes('vulkan')) return 'vulkan';
  if (source.includes('opencl') || source.includes('adreno')) return 'opencl';
  if (source.includes('rocm') || source.includes('hip')) return 'rocm';
  if (source.includes('sycl')) return 'sycl';
  if (source.includes('cpu')) return 'cpu';
  return 'unknown';
}

export function isGpuLikeRuntimeDevice(device: LlamaCppRuntimeDevice): boolean {
  return device.backend !== 'cpu' && device.backend !== 'unknown';
}

