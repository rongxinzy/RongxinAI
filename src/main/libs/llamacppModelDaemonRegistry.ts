import fs from 'node:fs/promises';
import path from 'node:path';

const DAEMON_REGISTRY_FILE = 'llamacpp-model-daemon.json';
const DAEMON_REGISTRY_VERSION = 1;

export type LlamaCppModelDaemonRegistry = {
  version: 1;
  pid: number;
  controlPort: number;
  gatewayPort: number;
  startedAt: string;
  models: Array<{
    modelName: string;
    modelPath: string;
    port: number;
    logSessionId: string;
  }>;
};

export function getLlamaCppModelDaemonRegistryPath(userDataPath: string): string {
  return path.join(userDataPath, DAEMON_REGISTRY_FILE);
}

export async function readLlamaCppModelDaemonRegistry(
  userDataPath: string,
): Promise<LlamaCppModelDaemonRegistry | null> {
  try {
    const raw = await fs.readFile(getLlamaCppModelDaemonRegistryPath(userDataPath), 'utf8');
    return parseLlamaCppModelDaemonRegistry(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

export async function writeLlamaCppModelDaemonRegistry(
  userDataPath: string,
  registry: LlamaCppModelDaemonRegistry,
): Promise<void> {
  const targetPath = getLlamaCppModelDaemonRegistryPath(userDataPath);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  const temporaryPath = `${targetPath}.tmp`;
  await fs.writeFile(temporaryPath, JSON.stringify(registry), 'utf8');
  await fs.rename(temporaryPath, targetPath);
}

function parseLlamaCppModelDaemonRegistry(value: unknown): LlamaCppModelDaemonRegistry | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  if (
    candidate.version !== DAEMON_REGISTRY_VERSION ||
    !isPort(candidate.controlPort) ||
    !isPort(candidate.gatewayPort) ||
    !isPositiveInteger(candidate.pid) ||
    typeof candidate.startedAt !== 'string' ||
    !Array.isArray(candidate.models)
  ) {
    return null;
  }
  const models = candidate.models.map(parseModel).filter((model): model is NonNullable<typeof model> => Boolean(model));
  if (models.length !== candidate.models.length) return null;
  return {
    version: DAEMON_REGISTRY_VERSION,
    pid: candidate.pid,
    controlPort: candidate.controlPort,
    gatewayPort: candidate.gatewayPort,
    startedAt: candidate.startedAt,
    models,
  };
}

function parseModel(value: unknown) {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.modelName !== 'string' ||
    typeof candidate.modelPath !== 'string' ||
    typeof candidate.logSessionId !== 'string' ||
    !isPort(candidate.port)
  ) {
    return null;
  }
  return {
    modelName: candidate.modelName,
    modelPath: candidate.modelPath,
    port: candidate.port,
    logSessionId: candidate.logSessionId,
  };
}

function isPort(value: unknown): value is number {
  return isPositiveInteger(value) && value <= 65_535;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}
