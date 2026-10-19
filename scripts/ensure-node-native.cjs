const { spawnSync } = require('node:child_process');
const path = require('node:path');

function loads(probe) {
  return spawnSync(process.execPath, ['-e', probe], { stdio: 'ignore' }).status === 0;
}
const probes = {
  'better-sqlite3':
    "const DB=require('better-sqlite3');const db=new DB(':memory:');db.prepare('select 1').get();db.close()",
  'node-pty': "if(typeof require('node-pty').spawn!=='function')throw new Error('Missing PTY API')",
};
for (const [name, probe] of Object.entries(probes)) {
  if (!loads(probe)) {
    const result = spawnSync(
      process.execPath,
      [require.resolve('node-gyp/bin/node-gyp.js'), 'rebuild', '--release'],
      {
        cwd: path.dirname(require.resolve(`${name}/package.json`)),
        stdio: 'inherit',
      },
    );
    if (result.status !== 0 || !loads(probe))
      throw new Error(`${name} failed the Node ABI load probe after rebuilding`);
  }
  console.log(`[NodeNative] ${name} loaded successfully for Node ABI ${process.versions.modules}`);
}
