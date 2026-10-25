import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import { EngramManager } from '../../src/main/memory/engramManager.ts';
import { ZhiYuanEngramAdapter } from '../../src/main/memory/zhiyuanEngramAdapter.ts';
import {
  EngramEnvironment,
  EngramMemoryScope,
  EngramObservationType,
} from '../../src/main/memory/constants.ts';

// Manual Bun acceptance. Only this script's newly created synthetic store is upgraded.
const [previousBinary, nextBinary] = process.argv.slice(2);
if (!previousBinary || !nextBinary)
  throw new Error(
    'Usage: bun scripts/companion/verify-memory-runtime-upgrade.mjs <previous binary> <next binary>',
  );
const userData = await fs.mkdtemp('/tmp/companion-memory-upgrade-');
const version = binary =>
  execFileSync(binary, ['version'], {
    encoding: 'utf8',
    env: { ...process.env, ENGRAM_NO_UPDATE_CHECK: '1' },
  }).trim();
const owners = [
  {
    project: 'companion://zhiyuan-agent/00000000-0000-4000-8000-000000000001',
    scope: EngramMemoryScope.Companion,
  },
  {
    project: 'companion://zhiyuan-agent/00000000-0000-4000-8000-000000000002',
    scope: EngramMemoryScope.Companion,
  },
  { project: 'personal://zhiyuan-agent/user', scope: EngramMemoryScope.Personal },
  { project: 'workspace-runtime-upgrade-fixture', scope: EngramMemoryScope.Project },
];
let runtime;
async function start(binary) {
  let child;
  const manager = new EngramManager({
    userDataPath: userData,
    env: { ...process.env, [EngramEnvironment.BinaryPath]: path.resolve(binary) },
    spawnProcess(file, env) {
      child = spawn(file, ['serve'], { env, stdio: 'ignore', windowsHide: true });
      return child;
    },
  });
  runtime = {
    manager,
    adapter: new ZhiYuanEngramAdapter(manager),
    async close() {
      const exited = child && child.exitCode === null ? once(child, 'exit') : Promise.resolve();
      await manager.stop();
      let timeout;
      try {
        await Promise.race([
          exited,
          new Promise((_, reject) => {
            timeout = setTimeout(
              () => reject(new Error('Owned memory process did not exit')),
              5000,
            );
          }),
        ]);
      } finally {
        clearTimeout(timeout);
      }
    },
  };
  assert(await manager.start(), 'Memory runtime must pass its health check');
  return runtime.adapter;
}
const save = async (adapter, owner, index, content) => {
  const candidate = adapter.saveCandidate({
    sessionId: `upgrade-owner-${index}`,
    ...owner,
    type: EngramObservationType.Preference,
    title: `Upgrade fixture ${index}`,
    content,
  });
  const id = await adapter.confirmMemory(candidate.id, userData);
  assert(Number.isSafeInteger(id) && id > 0);
  return id;
};

try {
  const old = await start(previousBinary);
  const ids = [];
  for (const [index, owner] of owners.entries())
    ids.push(await save(old, owner, index, `迁移标记 数据库连接池 owner ${index}`));
  const deleted = await save(old, owners[0], 0, '已撤回标记 synthetic deleted fact');
  assert(await old.forget(deleted, false, owners[0].project));
  await runtime.close();
  runtime = undefined;
  // The child has actually exited: copy a closed store, never a live SQLite WAL.
  await fs.cp(path.join(userData, 'memory'), path.join(userData, 'before-upgrade'), {
    recursive: true,
  });
  const upgraded = await start(nextBinary);
  for (const [index, owner] of owners.entries()) {
    const records = await upgraded.recall({ ...owner, query: '迁移标记', limit: 8 });
    assert.deepEqual(
      records.map(record => record.id),
      [ids[index]],
      `Owner ${index} must retain exactly its own ID`,
    );
    assert.equal(records[0].content, `迁移标记 数据库连接池 owner ${index}`);
  }
  assert.deepEqual(await upgraded.recall({ ...owners[0], query: '已撤回标记' }), []);
  assert(await upgraded.forget(deleted, true, owners[0].project));
  const connection = runtime.manager.getConnection();
  const wrongOwner = await fetch(
    `${connection.url}/observations/${ids[0]}?hard=true&expected_project=${encodeURIComponent(owners[1].project)}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${connection.token}` },
      signal: AbortSignal.timeout(5000),
    },
  );
  assert.equal(wrongOwner.status, 409, 'Upgrade must retain transactional owner checks');
  assert.deepEqual(
    (await upgraded.recall({ ...owners[0], query: '迁移标记' })).map(record => record.id),
    [ids[0]],
  );
  const result = {
    userData,
    previousVersion: version(previousBinary),
    nextVersion: version(nextBinary),
    owners: owners.length,
    sameObservationIds: true,
    sameContent: true,
    isolation: true,
    deletedHidden: true,
    hardDeleteAfterUpgrade: true,
    wrongOwnerRejected: true,
    actualUserDataTouched: false,
  };
  await fs.writeFile(path.join(userData, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  await runtime?.close();
}
