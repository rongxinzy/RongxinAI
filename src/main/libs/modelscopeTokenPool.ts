import fs from 'fs';
import path from 'path';

type TokenResource = {
  tokens?: unknown;
};

export type ModelScopeTokenPool = {
  nextToken: () => string | null;
  size: () => number;
};

const TOKEN_RESOURCE_FILE = 'modelscope.tokens.local.json';

export function createModelScopeTokenPool(options: {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  resourcesPath?: string;
  extraTokens?: string[];
} = {}): ModelScopeTokenPool {
  const tokens = uniqueTokens([
    ...(options.extraTokens ?? []),
    ...parseEnvTokens(options.env ?? process.env),
    ...readDotEnvTokens(options.cwd ?? process.cwd()),
    ...readTokenResourceCandidates(options.cwd ?? process.cwd(), options.resourcesPath),
  ]);
  let index = 0;

  return {
    nextToken: () => {
      if (tokens.length === 0) return null;
      const token = tokens[index % tokens.length];
      index += 1;
      return token;
    },
    size: () => tokens.length,
  };
}

function parseEnvTokens(env: NodeJS.ProcessEnv): string[] {
  return splitTokenValue(
    env.MODELSCOPE_TOKENS
    || env.MODELSCOPE_TOKEN
    || env.MODELSCOPE_API_TOKENS
    || env.MODELSCOPE_API_TOKEN
    || '',
  );
}

function readDotEnvTokens(cwd: string): string[] {
  const envPath = path.join(cwd, '.env');
  if (!fs.existsSync(envPath)) return [];
  try {
    const parsed = parseDotEnv(fs.readFileSync(envPath, 'utf-8'));
    return splitTokenValue(
      parsed.MODELSCOPE_TOKENS
      || parsed.MODELSCOPE_TOKEN
      || parsed.MODELSCOPE_API_TOKENS
      || parsed.MODELSCOPE_API_TOKEN
      || '',
    );
  } catch {
    return [];
  }
}

function readTokenResourceCandidates(cwd: string, resourcesPath?: string): string[] {
  const processResourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  const candidates = [
    path.join(cwd, TOKEN_RESOURCE_FILE),
    path.join(cwd, 'resources', TOKEN_RESOURCE_FILE),
    ...(resourcesPath ? [path.join(resourcesPath, TOKEN_RESOURCE_FILE)] : []),
    ...(processResourcesPath ? [path.join(processResourcesPath, TOKEN_RESOURCE_FILE)] : []),
  ];

  return candidates.flatMap(readTokenResourceFile);
}

function readTokenResourceFile(filePath: string): string[] {
  if (!fs.existsSync(filePath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as TokenResource;
    if (Array.isArray(parsed.tokens)) {
      return parsed.tokens.flatMap((value) => splitTokenValue(String(value)));
    }
  } catch {
    return [];
  }
  return [];
}

function parseDotEnv(content: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    values[match[1]] = unwrapDotEnvValue(match[2].trim());
  }
  return values;
}

function unwrapDotEnvValue(value: string): string {
  const quote = value[0];
  if ((quote === '"' || quote === '\'') && value.endsWith(quote)) {
    return value.slice(1, -1);
  }
  return value.replace(/\s+#.*$/, '').trim();
}

function splitTokenValue(value: string): string[] {
  return value
    .split(/[,\n]/)
    .map(token => token.trim())
    .filter(Boolean);
}

function uniqueTokens(tokens: string[]): string[] {
  return [...new Set(tokens)];
}
