const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdtemp, readFile, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const helper = path.resolve(process.argv[2] || 'resources/python-runtime/job-runner.exe');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function eventually(fn) {
  for (let i = 0; i < 100; i++) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {}
    await delay(50);
  }
  throw Error('Timed out waiting for process state');
}
const alive = pid => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

test(
  'real Job Object kills child and grandchild when helper is terminated',
  { skip: process.platform !== 'win32' },
  async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'python-job-'));
    const pidFile = path.join(dir, 'pids.json');
    const code = `const {spawn}=require('child_process');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});require('fs').writeFileSync(${JSON.stringify(pidFile)},JSON.stringify([process.pid,child.pid]));setInterval(()=>{},1000);`;
    const processInJob = spawn(helper, [String(process.pid), process.execPath, '-e', code], {
      stdio: 'ignore',
    });
    let pids = [];
    try {
      pids = await eventually(async () => JSON.parse(await readFile(pidFile, 'utf8')));
      assert.ok(pids.every(alive));
      processInJob.kill();
      await eventually(() => pids.every(pid => !alive(pid)));
    } finally {
      processInJob.kill();
      await rm(dir, { recursive: true, force: true });
    }
  },
);

test(
  'real Job Object watches Runner death and preserves Unicode/quoted arguments',
  { skip: process.platform !== 'win32' },
  async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'python-job-parent-'));
    const file = path.join(dir, 'child.json');
    const value = '文档 spaces "quotes" trailing\\';
    const childCode = `require('fs').writeFileSync(${JSON.stringify(file)},JSON.stringify({pid:process.pid,value:process.argv[1]}));setInterval(()=>{},1000);`;
    const parentCode = `require('child_process').spawn(${JSON.stringify(helper)},[String(process.pid),process.execPath,'-e',${JSON.stringify(childCode)},${JSON.stringify(value)}],{stdio:'ignore'});setInterval(()=>{},1000);`;
    const parent = spawn(process.execPath, ['-e', parentCode], { stdio: 'ignore' });
    try {
      const result = await eventually(async () => JSON.parse(await readFile(file, 'utf8')));
      assert.equal(result.value, value);
      assert.ok(alive(result.pid));
      parent.kill();
      await eventually(() => !alive(result.pid));
    } finally {
      parent.kill();
      await rm(dir, { recursive: true, force: true });
    }
  },
);
