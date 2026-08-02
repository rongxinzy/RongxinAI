import fs from 'fs';
import path from 'path';

import type { LlamaCppModel } from '../../shared/llamacpp';
import { ggufSupportsThinkingToggle } from './ggufMetadata';

export function scanLocalGgufModels(modelsDir: string): LlamaCppModel[] {
  const root = path.resolve(modelsDir);
  if (!fs.existsSync(root)) return [];
  const files = walkGgufFiles(root).filter(filePath => {
    const baseName = path.basename(filePath);
    if (/^mmproj/i.test(baseName)) return false;
    // Split-GGUF models are registered once, under their first part; later
    // parts would otherwise show up as duplicate standalone models.
    const shard = baseName.match(/-(\d{5})-of-\d{5}\.gguf$/i);
    if (shard && shard[1] !== '00001') return false;
    return true;
  });
  const nameCounts = new Map<string, number>();
  return files.map(filePath => {
    const baseName = resolveInstalledModelName(root, filePath);
    const count = nameCounts.get(baseName) ?? 0;
    nameCounts.set(baseName, count + 1);
    const name = count === 0 ? baseName : `${baseName}/${path.basename(filePath, '.gguf')}`;
    const stat = fs.statSync(filePath);
    return {
      name,
      id: name,
      model: name,
      path: filePath,
      modified_at: stat.mtime.toISOString(),
      size: stat.size,
      supportsThinkingToggle: ggufSupportsThinkingToggle(filePath),
      source: filePath.includes(`${path.sep}modelscope${path.sep}`) ? 'modelscope' : 'local',
      status: 'unloaded',
      details: {
        format: 'gguf',
        quantization_level: inferQuantizationFromFilename(path.basename(filePath)),
      },
    };
  });
}

export function mergeLocalModels(
  routerModels: LlamaCppModel[],
  scannedModels: LlamaCppModel[],
  modelsDir?: string,
): LlamaCppModel[] {
  const merged = new Map<string, LlamaCppModel>();
  for (const model of scannedModels) {
    merged.set(model.path ? `path:${path.resolve(model.path)}` : `name:${model.name}`, model);
  }
  for (const model of routerModels) {
    if (!model.path || !isGgufPath(model.path)) continue;
    const pathKey = model.path ? `path:${path.resolve(model.path)}` : undefined;
    if (modelsDir && pathKey && !isPathInside(path.resolve(model.path), path.resolve(modelsDir))) {
      merged.set(pathKey, model);
      continue;
    }
    const existing = pathKey ? merged.get(pathKey) : undefined;
    merged.set(pathKey ?? `name:${model.name}`, {
      ...existing,
      ...model,
      path: model.path ?? existing?.path,
      size: model.size ?? existing?.size,
      modified_at: model.modified_at ?? existing?.modified_at,
      details: { ...existing?.details, ...model.details },
    });
  }
  return Array.from(merged.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export function isPathInside(target: string, root: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function resolveInstalledModelName(modelsDir: string, modelPath: string): string {
  const root = path.resolve(modelsDir);
  const target = path.resolve(modelPath);
  const relative = path.relative(root, target);
  const parent = path.dirname(relative);
  if (!parent || parent === '.') return path.basename(target, '.gguf');
  return path.basename(parent);
}

function walkGgufFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of safeReadDir(dir)) {
    const candidate = path.join(dir, entry);
    if (safeIsDirectory(candidate)) {
      files.push(...walkGgufFiles(candidate));
    } else if (candidate.toLowerCase().endsWith('.gguf')) {
      files.push(candidate);
    }
  }
  return files;
}

function safeReadDir(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function safeIsDirectory(target: string): boolean {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

function inferQuantizationFromFilename(fileName: string): string | undefined {
  return fileName
    .toUpperCase()
    .match(/\b(Q[2-8](?:_[A-Z0-9]+){0,3}|F16|F32|BF16|IQ[1-4]_[A-Z0-9_]+)\b/)?.[1];
}

function isGgufPath(value: string): boolean {
  const pathname = /^https?:\/\//i.test(value) ? new URL(value).pathname : value;
  return pathname.toLowerCase().endsWith('.gguf');
}
