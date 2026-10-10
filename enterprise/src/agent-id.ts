import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const AGENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export async function resolveZhiyuanAgentId(userDataPath: string): Promise<string> {
  const directory = path.join(path.resolve(userDataPath), 'zhiyuan-enterprise');
  const filePath = path.join(directory, 'agent-id');
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });

  const existing = await readSettledAgentId(filePath);
  if (existing !== null) return existing;

  const agentId = randomUUID();
  try {
    await fs.writeFile(filePath, `${agentId}\n`, { flag: 'wx', mode: 0o600 });
    await fs.chmod(filePath, 0o600);
    return agentId;
  } catch (error) {
    if (!isNodeError(error, 'EEXIST')) throw error;
    // A concurrent startup claimed the file a moment ago; its content lands
    // within one write call, so poll briefly instead of reading the empty
    // create-then-write gap and reporting it as corruption.
    return waitForAgentId(filePath);
  }
}

// Reads the persisted ID, treating "missing" and "created but not yet
// written" the same: null means the caller should claim the file. A
// non-empty value that fails the pattern is real corruption and throws.
async function readSettledAgentId(filePath: string): Promise<string | null> {
  let value: string;
  try {
    value = (await fs.readFile(filePath, 'utf8')).trim();
  } catch (error) {
    if (isNodeError(error, 'ENOENT')) return null;
    throw error;
  }
  if (value === '') return null;
  assertAgentIdPattern(value);
  return value;
}

async function waitForAgentId(filePath: string, attempts = 25): Promise<string> {
  let last = '';
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    last = (await fs.readFile(filePath, 'utf8')).trim();
    if (last !== '') {
      assertAgentIdPattern(last);
      return last;
    }
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('Zhiyuan Agent ID file is invalid.');
}

function assertAgentIdPattern(value: string): void {
  if (!AGENT_ID_PATTERN.test(value)) {
    throw new Error('Zhiyuan Agent ID file is invalid.');
  }
}

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}
