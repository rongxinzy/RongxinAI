const fs = require('node:fs');
const path = require('node:path');
const { sha256File } = require('../windows-resource-pack.cjs');

const [action, root] = process.argv.slice(2);
const marker = '.ci-integrity.json';
const entries = {};
function walk(relative = '') {
  for (const entry of fs
    .readdirSync(path.join(root, relative), { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))) {
    const name = relative ? `${relative}/${entry.name}` : entry.name;
    if (name === marker) continue;
    if (entry.isSymbolicLink()) throw new Error('Runtime cache must not contain symlinks');
    if (entry.isDirectory()) walk(name);
    else if (entry.isFile()) entries[name] = sha256File(path.join(root, name));
    else throw new Error('Unsupported runtime cache entry');
  }
}
walk();
if (!Object.keys(entries).length) throw new Error('Runtime tree is empty');
const serialized = JSON.stringify(entries);
if (action === 'seal') fs.writeFileSync(path.join(root, marker), serialized);
else if (action !== 'verify' || fs.readFileSync(path.join(root, marker), 'utf8') !== serialized) {
  throw new Error('Compiled runtime cache integrity mismatch');
}
console.log('[RuntimeIntegrity] Verified ' + Object.keys(entries).length + ' files');
