'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { LINUX_NATIVE_GLIBC_BASELINE } = require('./linux-native-baseline.constants.cjs');
const { assertMaxGlibcVersion } = require('./linux-glibc-version.cjs');

const NODE_PTY_RELATIVE_CANDIDATES = [
  'build/Release/pty.node',
  'build/Debug/pty.node',
  'prebuilds/linux-x64/pty.node',
];

function packagedNodePtyRoots(appOutDir) {
  const roots = [
    path.join(appOutDir, 'resources', 'app.asar.unpacked', 'node_modules', 'node-pty'),
    path.join(appOutDir, 'resources', 'app', 'node_modules', 'node-pty'),
  ];
  if (!fs.existsSync(appOutDir)) return roots;
  for (const entry of fs.readdirSync(appOutDir)) {
    if (!entry.endsWith('.app')) continue;
    roots.push(
      path.join(
        appOutDir,
        entry,
        'Contents',
        'Resources',
        'app.asar.unpacked',
        'node_modules',
        'node-pty',
      ),
    );
  }
  return roots;
}

function findPackagedNodePtyBinding(appOutDir) {
  for (const root of packagedNodePtyRoots(appOutDir)) {
    if (!fs.existsSync(root)) continue;
    for (const relative of NODE_PTY_RELATIVE_CANDIDATES) {
      const candidate = path.join(root, relative);
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }
  return null;
}

function verifyPackagedNodePty(context) {
  if (context.electronPlatformName !== 'linux') return;

  const binding = findPackagedNodePtyBinding(context.appOutDir);
  if (!binding) {
    throw new Error(
      '[PackagedNativeVerify] Missing packaged node-pty binding for linux-x64. ' +
        'Expected pty.node under app.asar.unpacked/node_modules/node-pty ' +
        '(build/Release or prebuilds/linux-x64). Run bun run rebuild:electron-native before packaging.',
    );
  }

  const stats = fs.statSync(binding);
  if (!stats.isFile() || stats.size === 0) {
    throw new Error(`[PackagedNativeVerify] Packaged node-pty binding is empty: ${binding}`);
  }

  const observedGlibc = assertMaxGlibcVersion(binding, LINUX_NATIVE_GLIBC_BASELINE);
  console.log(
    `[PackagedNativeVerify] node-pty glibc max ${observedGlibc} (baseline <= ${LINUX_NATIVE_GLIBC_BASELINE})`,
  );
}

module.exports = {
  NODE_PTY_RELATIVE_CANDIDATES,
  findPackagedNodePtyBinding,
  verifyPackagedNodePty,
};
