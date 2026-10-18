import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';

import type { LlamaCppModelLaunchInput, LlamaCppServiceConfig } from '../../shared/llamacpp';
import { buildLlamaServerArgs } from './llamacppServe';
import {
  buildLlamaCppPresetGlobalGpuSection,
  LLAMACPP_PRESET_GLOBAL_GPU_KEYS,
  modelLaunchOptionsToPreset,
  replaceIniSectionKeys,
  upsertIniSection,
} from './llamacppManager';

/** The router always binds loopback; the gateway owns the user-facing port. */
export const LLAMACPP_ROUTER_LOOPBACK_HOST = '127.0.0.1';
/** Router-side LRU is disabled; the app enforces the loaded-model capacity. */
const LLAMACPP_ROUTER_UNLIMITED_MODELS_MAX = '0';

/**
 * Router command line for the orchestrator: the shared router args pinned to a
 * loopback ephemeral port (never config.port, which the gateway owns) and to
 * an unlimited router-side model budget. buildLlamaServerArgs always emits the
 * next-token flag form, so an override replaces the value that follows.
 */
export function buildLlamaCppRouterProcessArgs(input: {
  config: LlamaCppServiceConfig;
  modelsDir: string;
  presetPath: string;
  port: number;
}): string[] {
  const base = buildLlamaServerArgs(input.config, input.modelsDir, input.presetPath);
  const withHost = overrideArg(base, '--host', LLAMACPP_ROUTER_LOOPBACK_HOST);
  const withPort = overrideArg(withHost, '--port', String(input.port));
  return overrideArg(withPort, '--models-max', LLAMACPP_ROUTER_UNLIMITED_MODELS_MAX);
}

function overrideArg(args: string[], flag: string, value: string): string[] {
  const index = args.findIndex(entry => entry === flag);
  if (index === -1) return [...args, flag, value];
  const next = [...args];
  next[index + 1] = value;
  return next;
}

function readPresetSource(presetPath: string): string {
  return fs.existsSync(presetPath) ? fs.readFileSync(presetPath, 'utf-8') : 'version = 1\n\n';
}

function writePresetSource(presetPath: string, source: string): void {
  fs.mkdirSync(path.dirname(presetPath), { recursive: true });
  fs.writeFileSync(presetPath, source, 'utf-8');
}

/** Keeps the preset's global `[*]` GPU defaults in sync with the service config. */
export function writeLlamaCppRouterPresetGlobalSection(input: {
  presetPath: string;
  config: LlamaCppServiceConfig;
}): void {
  const next = replaceIniSectionKeys(
    readPresetSource(input.presetPath),
    '*',
    LLAMACPP_PRESET_GLOBAL_GPU_KEYS,
    buildLlamaCppPresetGlobalGpuSection(input.config),
  );
  writePresetSource(input.presetPath, next);
}

/** Writes the per-model preset section (model path + launch options, GPU placement included). */
export function upsertLlamaCppRouterModelPresetSection(input: {
  presetPath: string;
  modelName: string;
  modelPath: string;
  options?: LlamaCppModelLaunchInput['options'];
}): void {
  const next = upsertIniSection(readPresetSource(input.presetPath), input.modelName.trim(), {
    model: input.modelPath,
    ...modelLaunchOptionsToPreset(input.options ?? {}),
  });
  writePresetSource(input.presetPath, next);
}

/** Reserves an ephemeral loopback port for the router process. */
export function findAvailableLlamaCppRouterPort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, LLAMACPP_ROUTER_LOOPBACK_HOST, () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Could not reserve a router port.'));
        return;
      }
      server.close(error => (error ? reject(error) : resolve(address.port)));
    });
  });
}
