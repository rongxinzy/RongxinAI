import fs from 'fs';
import path from 'path';

import type { LlamaCppModel } from '../../shared/llamacpp';
import { ggufSupportsThinkingToggle } from './ggufMetadata';
import { isPathInside } from '../pathContainment';
import { LOCAL_GGUF_CATALOG_LIMIT } from './llamacppModelCatalogLimits';

export { isPathInside };

const MMPROJ_FILE_PATTERN = /(?:^|[._-])mmproj(?:[._-]|$)/i;

export function scanLocalGgufModels(modelsDir: string): LlamaCppModel[] {
  const root = path.resolve(modelsDir);
  const nameCounts = new Map<string, number>();
  return walkGgufFiles(root).flatMap<LlamaCppModel>(filePath => {
    const stat = fs.statSync(filePath, { throwIfNoEntry: false });
    if (!stat?.isFile()) return [];
    const baseName = resolveInstalledModelName(root, filePath);
    const count = nameCounts.get(baseName) ?? 0;
    nameCounts.set(baseName, count + 1);
    const name = count === 0 ? baseName : `${baseName}/${path.basename(filePath, '.gguf')}`;
    return [
      {
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
      },
    ];
  });
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
  const ancestors = new Set<string>();
  let entries = 0;
  function visit(directory: string): void {
    let realDirectory: string;
    let names: fs.Dirent[];
    try {
      realDirectory = fs.realpathSync(directory);
      if (ancestors.has(realDirectory)) return;
      names = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    entries += names.length;
    if (
      entries > LOCAL_GGUF_CATALOG_LIMIT.Entries ||
      ancestors.size >= LOCAL_GGUF_CATALOG_LIMIT.DirectoryDepth
    )
      throw new Error('Local model directory scan limit exceeded.');

    ancestors.add(realDirectory);
    for (const name of names) {
      const candidate = path.join(directory, name.name);
      let target: fs.Dirent | fs.Stats | undefined = name;
      if (name.isSymbolicLink()) {
        try {
          target = fs.statSync(candidate, { throwIfNoEntry: false });
        } catch {
          continue;
        }
      }
      if (target?.isDirectory()) {
        visit(candidate);
      } else if (
        target?.isFile() &&
        name.name.toLowerCase().endsWith('.gguf') &&
        !MMPROJ_FILE_PATTERN.test(name.name)
      ) {
        // Register a split model under its first file only.
        const shard = name.name.match(/-(\d{5})-of-\d{5}\.gguf$/i);
        if (shard && shard[1] !== '00001') continue;
        if (files.length >= LOCAL_GGUF_CATALOG_LIMIT.Models)
          throw new Error('Local model catalog limit exceeded.');
        files.push(candidate);
      }
    }
    ancestors.delete(realDirectory);
  }
  visit(dir);
  return files;
}

function inferQuantizationFromFilename(fileName: string): string | undefined {
  return fileName
    .toUpperCase()
    .match(/\b(Q[2-8](?:_[A-Z0-9]+){0,3}|F16|F32|BF16|IQ[1-4]_[A-Z0-9_]+)\b/)?.[1];
}
