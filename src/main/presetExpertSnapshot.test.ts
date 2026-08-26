import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { afterEach, expect, test } from 'vitest';

import {
  resolveBundledPresetExpertSnapshot,
  resolveBundledPresetMembers,
} from './presetExpertSnapshot';

const skillsRoot = path.resolve('SKILLs');

test('reads a bundled expert preset live from disk', () => {
  const snapshot = resolveBundledPresetExpertSnapshot(skillsRoot, 'data-analyst');
  expect(snapshot).not.toBeNull();
  expect(snapshot?.promptSnapshot).toContain('工作流路由');
  expect(snapshot?.promptSnapshot).toContain('数据分析专家');
  expect(snapshot?.skillIds).toEqual(
    expect.arrayContaining(['data-quality-review', 'metric-diagnosis', 'analytics-report']),
  );
});

test('loads the complete text-to-cad skill set for the CAD engineering expert', () => {
  const snapshot = resolveBundledPresetExpertSnapshot(skillsRoot, 'cad-engineering-expert');

  expect(snapshot).not.toBeNull();
  expect(snapshot?.promptSnapshot).toContain('CAD 工程专家');
  expect(snapshot?.skillIds).toEqual([
    'cad',
    'cad-viewer',
    'step-parts',
    'dxf',
    'urdf',
    'srdf',
    'sdf',
    'sendcutsend',
    'dfam-check',
    'gcode',
    'bambu-labs',
    'implicit-cad',
  ]);
});

test('returns null for a missing preset', () => {
  expect(resolveBundledPresetExpertSnapshot(skillsRoot, 'no-such-preset')).toBeNull();
});

test('returns null for an unreadable preset directory', () => {
  expect(resolveBundledPresetExpertSnapshot(path.resolve('SKILLs', '..', 'no-such-root'), 'data-analyst')).toBeNull();
});

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

/** Minimal bundled team preset in a temp dir with a lead and two members. */
const buildTeamPreset = (): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'preset-expert-team-'));
  temporaryDirectories.push(root);
  const presetDir = path.join(root, 'zhiyuan-expert-manager', 'presets', 'team-fixture');
  fs.mkdirSync(path.join(presetDir, 'agents'), { recursive: true });
  // Copy the real registration scripts so the snapshot's skill resolution
  // follows the production path (packaged skills appended to declared ids).
  const scriptsDir = path.join(root, 'zhiyuan-expert-manager', 'scripts');
  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.copyFileSync(
    path.resolve('SKILLs/zhiyuan-expert-manager/scripts/register_expert.js'),
    path.join(scriptsDir, 'register_expert.js'),
  );
  fs.copyFileSync(
    path.resolve('SKILLs/zhiyuan-expert-manager/scripts/validate_expert.js'),
    path.join(scriptsDir, 'validate_expert.js'),
  );
  fs.writeFileSync(
    path.join(presetDir, 'plugin.json'),
    JSON.stringify(
      {
        name: 'team-fixture',
        expertType: 'team',
        agentName: 'team-fixture-team-lead',
        teamInfo: {
          leadAgent: 'team-fixture-team-lead',
          memberAgents: ['member-alpha', 'member-beta'],
        },
        agents: [
          './agents/team-fixture-team-lead.md',
          './agents/member-alpha.md',
          './agents/member-beta.md',
        ],
        members: [
          { id: 'member-alpha', profession: { zh: '研究员' } },
          { id: 'member-beta', profession: { zh: '分析师' } },
        ],
        skills: ['./skills/team-skill'],
        skillIds: ['web-search'],
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    path.join(presetDir, 'agents', 'team-fixture-team-lead.md'),
    [
      '---',
      'name: team-fixture-team-lead',
      'description: Team lead.',
      '---',
      '# 团队主理人',
      '',
      '你是团队主理人。',
      '',
      '## 工作流路由（CRITICAL — 收到请求时首先判断）',
      '',
      '| 场景 | 判定条件 | 使用模式 |',
      '|------|---------|---------|',
      '| 标准任务 | 复杂需求 | SOP |',
    ].join('\n'),
  );
  fs.writeFileSync(
    path.join(presetDir, 'agents', 'member-alpha.md'),
    [
      '---',
      'name: member-alpha',
      'description: Alpha member.',
      '---',
      '# Alpha 成员',
      '',
      '你是团队的**研究员**。',
    ].join('\n'),
  );
  fs.writeFileSync(
    path.join(presetDir, 'agents', 'member-beta.md'),
    [
      '---',
      'name: member-beta',
      'description: Beta member.',
      '---',
      '# Beta 成员',
      '',
      '你是团队的**分析师**。',
    ].join('\n'),
  );
  fs.mkdirSync(path.join(presetDir, 'skills', 'team-skill'), { recursive: true });
  fs.writeFileSync(
    path.join(presetDir, 'skills', 'team-skill', 'SKILL.md'),
    ['---', 'name: team-skill', 'description: Team skill.', '---', '', '# Team skill'].join('\n'),
  );
  return root;
};

test('team lead snapshot carries the member roster and team skills', () => {
  const root = buildTeamPreset();
  const lead = resolveBundledPresetExpertSnapshot(root, 'team-fixture', 'team-fixture-team-lead');
  expect(lead).not.toBeNull();
  expect(lead?.promptSnapshot).toContain('你是团队主理人');
  expect(lead?.promptSnapshot).toContain('## 已注册成员映射');
  expect(lead?.promptSnapshot).toContain('member-alpha（研究员）');
  expect(lead?.promptSnapshot).toContain('member-beta（分析师）');
  expect(lead?.skillIds).toEqual(['web-search', 'team-skill']);
  // The lead prompt must not leak member bodies.
  expect(lead?.promptSnapshot).not.toContain('你是团队的**研究员**');
});

test('member snapshot loads only the member file with no skills and no lead body', () => {
  const root = buildTeamPreset();
  const alpha = resolveBundledPresetExpertSnapshot(root, 'team-fixture', 'member-alpha');
  expect(alpha).not.toBeNull();
  expect(alpha?.promptSnapshot).toContain('你是团队的**研究员**');
  expect(alpha?.promptSnapshot).not.toContain('主理人');
  expect(alpha?.promptSnapshot).not.toContain('已注册成员映射');
  expect(alpha?.skillIds).toEqual([]);
});

test('resolves live bundled member definitions for the subagent tool', () => {
  const root = buildTeamPreset();
  const members = resolveBundledPresetMembers(root, 'team-fixture');
  expect(members).not.toBeNull();
  expect(members?.map(member => member.id)).toEqual(['member-alpha', 'member-beta']);
  expect(members?.find(member => member.id === 'member-alpha')?.systemPrompt).toContain(
    '研究员',
  );
});

test('does not resolve members for a single-agent or unknown preset', () => {
  const root = buildTeamPreset();
  expect(resolveBundledPresetMembers(root, 'no-such-preset')).toBeNull();
  expect(resolveBundledPresetMembers(skillsRoot, 'data-analyst')).toBeNull();
});

test('unknown or timestamp-suffixed agent ids resolve to null (DB fallback)', () => {
  const root = buildTeamPreset();
  // A never-registered id must not silently load agents[0] (wrong role).
  expect(resolveBundledPresetExpertSnapshot(root, 'team-fixture', 'no-such-agent')).toBeNull();
  // DB id conflicts append timestamps (member-alpha-1699999999); the suffix
  // never matches the preset file, so the caller must fall back to the DB
  // snapshot rather than combine a lead prompt with member skill policy.
  expect(
    resolveBundledPresetExpertSnapshot(root, 'team-fixture', 'member-alpha-1699999999'),
  ).toBeNull();
  expect(resolveBundledPresetExpertSnapshot(root, 'team-fixture', 'member-alpha')).not.toBeNull();
});
