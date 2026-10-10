import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import { AepClient, MemoryTokenStore } from '@aep/sdk-node';
import yazl from 'yazl';

import { requiredEnvironment } from './e2e-environment.mjs';

const require = createRequire(import.meta.url);
const { createZhiyuanAgentControlBackend } = require('../dist/extension.cjs');
const baseUrl = process.env.ZHIYUAN_AEP_BASE_URL ?? 'http://localhost:8080';
const deploymentId = process.env.ZHIYUAN_AEP_DEPLOYMENT_ID ?? 'demo';
const adminUsername = process.env.ZHIYUAN_AEP_ADMIN_USERNAME ?? 'admin';
const adminPassword = requiredEnvironment('ZHIYUAN_AEP_ADMIN_PASSWORD');
const memberRoleIdOverride = process.env.ZHIYUAN_AEP_E2E_ROLE_ID;
const memberRoleName = 'AaaS E2E member';
const runId = Date.now().toString(36);
const username = `aaas-e2e-${runId}`;
const password = `Zhiyuan-e2e-${runId}-password`;
let skillId;
const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyuan-aaas-e2e-'));

let admin;
let user;
let assignment;
let backend;

try {
  admin = client(`aaas-admin-${runId}`);
  await admin.loginWithPassword({
    deploymentId,
    username: adminUsername,
    password: adminPassword,
  });
  const memberRoleId = await ensureMemberRole(admin);
  user = await admin.createUser({
    deploymentId,
    username,
    displayName: `Zhiyuan AaaS E2E ${runId}`,
    temporaryPassword: password,
    teamIds: ['all-users'],
    roleIds: [memberRoleId],
    requirePasswordChange: false,
  });

  const archive = await createSkillArchive();
  const skill = await admin.createSkill({
    name: `AaaS E2E ${runId}`,
    description: 'Zhiyuan Agent control backend verification',
  });
  assert.ok(
    typeof skill?.id === 'string' && skill.id.length > 0,
    'createSkill did not return a server-generated id',
  );
  skillId = skill.id;
  await admin.uploadSkillVersion(skillId, '1.0.0', archive);
  await admin.publishSkillVersion(skillId, '1.0.0');
  assignment = await admin.createSkillAssignment({
    skillId,
    subject: { type: 'user', id: user.id },
  });

  const agent = client(`aaas-session-${runId}`);
  await agent.loginWithPassword({ deploymentId, username, password });
  backend = createZhiyuanAgentControlBackend({
    client: agent,
    databasePath: path.join(temporaryDirectory, 'agent-control.sqlite'),
    skillRoot: path.join(temporaryDirectory, 'managed-skills'),
    agentVersion: 'aaas-e2e',
    platform: platform(),
  });

  const installEvent = await publishSkillEvent(admin, 'install');
  await backend.runOnce();
  const installedDefinition = path.join(temporaryDirectory, 'managed-skills', skillId, 'SKILL.md');
  assert.equal(fs.readFileSync(installedDefinition, 'utf8'), '# Zhiyuan E2E Skill\n');
  await assertDelivery(admin, installEvent.eventId, 'succeeded');

  const telemetry = await admin.searchEvents({ userId: user.id });
  assert.equal(
    telemetry.items.some(item => item.type === 'skill.sync.completed'),
    true,
  );

  await admin.deleteSkillAssignment(assignment.id);
  assignment = null;
  const removeEvent = await publishSkillEvent(admin, 'remove');
  await backend.runOnce();
  assert.equal(fs.existsSync(path.dirname(installedDefinition)), false);
  await assertDelivery(admin, removeEvent.eventId, 'succeeded');

  console.log(
    JSON.stringify(
      {
        status: 'passed',
        baseUrl,
        userId: user.id,
        skillId,
        checks: [
          'password login and user-session binding',
          'persisted control delivery acknowledgement',
          'authorized Skill download and safe installation',
          'Skill sync result and user audit state',
          'telemetry upload',
          'assignment revocation and managed Skill removal',
        ],
      },
      null,
      2,
    ),
  );
} finally {
  await backend?.close().catch(() => undefined);
  if (admin && assignment?.id) {
    await admin.deleteSkillAssignment(assignment.id).catch(() => undefined);
  }
  if (admin) await admin.deleteSkill(skillId).catch(() => undefined);
  if (admin && user?.id) {
    await admin.updateUser(user.id, { status: 'disabled' }).catch(() => undefined);
    await revokeUserSessions(admin, user.id).catch(() => undefined);
  }
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}

async function ensureMemberRole(adminClient) {
  const page = await adminClient.listRoles({ limit: 200 });
  const existing = memberRoleIdOverride
    ? page.roles.find(role => role.id === memberRoleIdOverride)
    : page.roles.find(role => role.name === memberRoleName);
  if (existing) {
    assert.equal(existing.enabled, true, `E2E role ${existing.id} must be enabled`);
    assert.deepEqual(
      existing.permissions,
      [],
      `E2E role ${existing.id} must not grant permissions`,
    );
    return existing.id;
  }
  assert.ok(!memberRoleIdOverride, `E2E role override ${memberRoleIdOverride} does not exist`);
  const created = await adminClient.createRole({
    name: memberRoleName,
    description: 'Least-privileged role for disposable enterprise extension tests',
    permissions: [],
  });
  assert.ok(
    typeof created?.id === 'string' && created.id.length > 0,
    'createRole did not return a server-generated id',
  );
  return created.id;
}

async function revokeUserSessions(adminClient, userId) {
  const page = await adminClient.listUserSessions({ userId, limit: 200 });
  const sessions = Array.isArray(page.items) ? page.items : [];
  for (const session of sessions) {
    if (
      session &&
      typeof session === 'object' &&
      typeof session.sessionId === 'string' &&
      !session.revokedAt
    ) {
      await adminClient.revokeUserSession(session.sessionId);
    }
  }
}

function client(clientAgentId) {
  return new AepClient({
    baseUrl,
    agentId: clientAgentId,
    agentVersion: 'aaas-e2e',
    platform: platform(),
    tokenStore: new MemoryTokenStore(),
  });
}

async function publishSkillEvent(adminClient, phase) {
  return adminClient.createControlEvent({
    type: 'skill.manifest.changed',
    scope: { type: 'user', id: user.id },
    resource: { type: 'skill', id: skillId, revision: phase },
    task: { type: 'skill.reconcile' },
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    supersedesKey: `aaas-e2e:${skillId}:${phase}`,
  });
}

async function assertDelivery(adminClient, eventId, expectedState) {
  const page = await adminClient.listControlEventDeliveries(String(eventId));
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0].state, expectedState);
}

function platform() {
  if (process.platform === 'win32') return 'windows';
  if (process.platform === 'darwin') return 'macos';
  return 'linux';
}

function createSkillArchive() {
  return new Promise((resolve, reject) => {
    const archive = new yazl.ZipFile();
    const chunks = [];
    archive.outputStream.on('data', chunk => chunks.push(Buffer.from(chunk)));
    archive.outputStream.on('error', reject);
    archive.outputStream.on('end', () => resolve(new Uint8Array(Buffer.concat(chunks))));
    archive.addBuffer(Buffer.from('# Zhiyuan E2E Skill\n'), 'SKILL.md');
    archive.end();
  });
}
