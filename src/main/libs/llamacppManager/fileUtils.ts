import fs from 'fs';
import path from 'path';

import type { LlamaCppModelLaunchInput, LlamaCppServiceConfig } from '../../../shared/llamacpp';

export function normalizePositiveInteger(value: string | undefined): number | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * GPU placement for the router preset's global `[*]` section. Keys mirror
 * modelLaunchOptionsToPreset so a per-model section overrides them one by one.
 * Unset values are omitted so stale entries are removed on upsert.
 */
export const LLAMACPP_PRESET_GLOBAL_GPU_KEYS = [
  'n-gpu-layers',
  'device',
  'main-gpu',
  'split-mode',
  'tensor-split',
] as const;

export function buildLlamaCppPresetGlobalGpuSection(
  config: LlamaCppServiceConfig,
): Record<string, string> {
  const values: Record<string, string> = {};
  if (config.gpuLayers?.trim()) values['n-gpu-layers'] = config.gpuLayers.trim();
  if (config.device?.trim()) values.device = config.device.trim();
  if (config.mainGpu?.trim()) values['main-gpu'] = config.mainGpu.trim();
  if (config.splitMode?.trim()) values['split-mode'] = config.splitMode.trim();
  if (config.tensorSplit?.trim()) values['tensor-split'] = config.tensorSplit.trim();
  return values;
}

export function resolveImportedModelTargetPath(importDir: string, sourcePath: string): string {
  const extension = path.extname(sourcePath) || '.gguf';
  const baseName = path.basename(sourcePath, extension);
  let attempt = 0;

  while (true) {
    const suffix = attempt === 0 ? '' : `-${attempt + 1}`;
    const candidate = path.join(importDir, `${baseName}${suffix}${extension}`);
    if (!fs.existsSync(candidate)) {
      return candidate;
    }
    attempt += 1;
  }
}

export function modelLaunchOptionsToPreset(
  options: NonNullable<LlamaCppModelLaunchInput['options']>,
): Record<string, string | number | boolean> {
  return {
    ...(options.ctxSize !== undefined ? { 'ctx-size': options.ctxSize } : {}),
    ...(options.batchSize !== undefined ? { 'batch-size': options.batchSize } : {}),
    ...(options.ubatchSize !== undefined ? { 'ubatch-size': options.ubatchSize } : {}),
    ...(options.gpuLayers !== undefined ? { 'n-gpu-layers': options.gpuLayers } : {}),
    ...(options.threads !== undefined ? { threads: options.threads } : {}),
    ...(options.device ? { device: options.device } : {}),
    ...(options.mainGpu !== undefined ? { 'main-gpu': options.mainGpu } : {}),
    ...(options.splitMode ? { 'split-mode': options.splitMode } : {}),
    ...(options.tensorSplit ? { 'tensor-split': options.tensorSplit } : {}),
    ...(typeof options.mmap === 'boolean' ? { mmap: options.mmap } : {}),
    ...(options.flashAttn ? { 'flash-attn': options.flashAttn } : {}),
    ...(options.parallel !== undefined ? { parallel: options.parallel } : {}),
    ...(options.reasoning ? { reasoning: options.reasoning } : {}),
    ...(options.reasoningFormat && options.reasoningFormat !== 'auto'
      ? { 'reasoning-format': options.reasoningFormat }
      : {}),
    ...(options.chatTemplate ? { 'chat-template': options.chatTemplate } : {}),
  };
}

export function upsertIniSection(
  source: string,
  section: string,
  values: Record<string, string | number | boolean>,
): string {
  const lines = source.split(/\r?\n/);
  const start = lines.findIndex(line => line.trim() === `[${section}]`);
  const rendered = [
    `[${section}]`,
    ...Object.entries(values).map(([key, value]) => `${key} = ${value}`),
    '',
  ];
  if (start === -1) {
    return `${source.trimEnd()}\n\n${rendered.join('\n')}`;
  }
  let end = start + 1;
  while (end < lines.length && !/^\s*\[.+\]\s*$/.test(lines[end])) end += 1;
  return [...lines.slice(0, start), ...rendered, ...lines.slice(end)].join('\n').trimEnd() + '\n';
}

/**
 * Replaces only `managedKeys` within an INI section: keys the caller owns are
 * set from `values` (or removed when unset), while other keys in the section
 * are preserved. Used for the preset's global `[*]` GPU section, where the
 * service config owns GPU placement keys but must not clobber user or
 * future keys such as ctx-size.
 */
export function replaceIniSectionKeys(
  source: string,
  section: string,
  managedKeys: readonly string[],
  values: Record<string, string | number | boolean>,
): string {
  const lines = source.split(/\r?\n/);
  const start = lines.findIndex(line => line.trim() === `[${section}]`);
  const preserved: Record<string, string> = {};
  if (start !== -1) {
    let end = start + 1;
    while (end < lines.length && !/^\s*\[.+\]\s*$/.test(lines[end])) end += 1;
    const managedKeySet = new Set(managedKeys);
    for (const line of lines.slice(start + 1, end)) {
      const match = line.match(/^([^=]+?)\s*=\s*(.*)$/);
      if (!match) continue;
      const key = match[1].trim();
      if (managedKeySet.has(key)) continue;
      preserved[key] = match[2].trim();
    }
  }
  return upsertIniSection(source, section, { ...preserved, ...values });
}

export function removeEmptyParentDirs(startDir: string, stopDir: string): void {
  let currentDir = path.resolve(startDir);
  const resolvedStopDir = path.resolve(stopDir);

  while (currentDir.startsWith(resolvedStopDir + path.sep)) {
    if (!safeIsDirectoryEmpty(currentDir)) return;
    fs.rmdirSync(currentDir);
    currentDir = path.dirname(currentDir);
  }
}

function safeIsDirectoryEmpty(target: string): boolean {
  try {
    return fs.readdirSync(target).length === 0;
  } catch {
    return false;
  }
}

export function isGgufPath(value: string): boolean {
  const pathname = /^https?:\/\//i.test(value) ? new URL(value).pathname : value;
  return pathname.toLowerCase().endsWith('.gguf');
}
