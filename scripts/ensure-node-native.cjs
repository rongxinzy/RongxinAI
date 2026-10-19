const { spawnSync } = require('node:child_process');
const path = require('node:path');

const probe =
  "const DB=require('better-sqlite3');const db=new DB(':memory:');db.prepare('select 1').get();db.close()";
function loads() {
  return spawnSync(process.execPath, ['-e', probe], { stdio: 'ignore' }).status === 0;
}
if (!loads()) {
  const result = spawnSync(
    process.execPath,
    [require.resolve('node-gyp/bin/node-gyp.js'), 'rebuild', '--release'],
    {
      cwd: path.dirname(require.resolve('better-sqlite3/package.json')),
      stdio: 'inherit',
    },
  );
  if (result.status !== 0 || !loads())
    throw new Error('SQLite failed the Node ABI load probe after rebuilding');
}
console.log('[NodeNative] SQLite loaded successfully for Node ABI ' + process.versions.modules);
