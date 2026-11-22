import fs from 'node:fs/promises';
import path from 'node:path';

const DAEMON_REGISTRY_FILE = 'llamacpp-model-daemon.json';
const DAEMON_REGISTRY_VERSION = 1;

export type LlamaCppModelDaemonRegistryIdentity = {
  pid: number;
  controlPort: number;
  startedAt: string;
};

export function getLlamaCppModelDaemonRegistryPath(userDataPath: string): string {
  return path.join(userDataPath, DAEMON_REGISTRY_FILE);
}

export async function readLlamaCppModelDaemonRegistry(
  userDataPath: string,
): Promise<LlamaCppModelDaemonRegistryIdentity | null> {
  try {
    const raw = await fs.readFile(getLlamaCppModelDaemonRegistryPath(userDataPath), 'utf8');
    return parseLlamaCppModelDaemonRegistry(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

export async function writeLlamaCppModelDaemonRegistry(
  userDataPath: string,
  identity: LlamaCppModelDaemonRegistryIdentity,
): Promise<void> {
  const targetPath = getLlamaCppModelDaemonRegistryPath(userDataPath);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  const temporaryPath = `${targetPath}.tmp`;
  await fs.writeFile(
    temporaryPath,
    JSON.stringify({ version: DAEMON_REGISTRY_VERSION, ...identity }),
    'utf8',
  );
  await fs.rename(temporaryPath, targetPath);
}

export async function removeLlamaCppModelDaemonRegistry(
  userDataPath: string,
  identity: LlamaCppModelDaemonRegistryIdentity,
): Promise<void> {
  const current = await readLlamaCppModelDaemonRegistry(userDataPath);
  if (
    current?.pid === identity.pid &&
    current.startedAt === identity.startedAt &&
    current.controlPort === identity.controlPort
  ) {
    await fs.rm(getLlamaCppModelDaemonRegistryPath(userDataPath), { force: true });
  }
}

function parseLlamaCppModelDaemonRegistry(
  value: unknown,
): LlamaCppModelDaemonRegistryIdentity | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  if (
    candidate.version !== DAEMON_REGISTRY_VERSION ||
    !isPort(candidate.controlPort) ||
    !isPositiveInteger(candidate.pid) ||
    typeof candidate.startedAt !== 'string'
  ) {
    return null;
  }
  return {
    pid: candidate.pid,
    controlPort: candidate.controlPort,
    startedAt: candidate.startedAt,
  };
}

function isPort(value: unknown): value is number {
  return isPositiveInteger(value) && value <= 65_535;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}
