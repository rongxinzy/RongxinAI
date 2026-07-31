import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const repo = path.resolve(import.meta.dirname, '..');
const script = path.join(repo, 'scripts', 'prepare-visual-blind-review.mjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'visual-blind-review-'));

try {
  for (const taskId of ['ppt-mineral', 'web-field-culture']) {
    const task = path.join(root, taskId);
    fs.mkdirSync(task, { recursive: true });
    fs.writeFileSync(path.join(task, 'baseline.png'), 'baseline');
    fs.writeFileSync(path.join(task, 'candidate.png'), 'candidate');
    fs.writeFileSync(path.join(task, 'baseline.json'), JSON.stringify({ kind: taskId.startsWith('ppt') ? 'ppt' : 'website', preview: 'baseline.png' }));
    fs.writeFileSync(path.join(task, 'candidate.json'), JSON.stringify({ kind: taskId.startsWith('ppt') ? 'ppt' : 'website', preview: 'candidate.png' }));
  }
  const output = path.join(root, 'review');
  const result = spawnSync(process.execPath, [script, root, '--seed', 'test-seed', '--output', output], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const form = JSON.parse(fs.readFileSync(path.join(output, 'review-form.json'), 'utf8'));
  const key = JSON.parse(fs.readFileSync(path.join(output, 'blind-review-key.json'), 'utf8'));
  assert.equal(form.tasks.length, 2);
  assert.equal(key.tasks.length, 2);
  assert.deepEqual(Object.keys(form.tasks[0].choices[0]).sort(), ['label', 'preview']);
  assert.ok(fs.existsSync(path.join(output, form.tasks[0].choices[0].preview)));
  assert.ok(!JSON.stringify(form).includes('baseline'));
  assert.ok(!JSON.stringify(form).includes('candidate'));
  console.log('Visual blind review tests passed');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
