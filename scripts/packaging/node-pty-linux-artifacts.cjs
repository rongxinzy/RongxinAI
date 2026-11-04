'use strict';

/**
 * node-pty@1.1.0 binding.gyp defines the spawn-helper executable target only when
 * OS=="mac". Linux PtyFork uses forkpty(3) and never executes spawn-helper.
 */
const LINUX_NODE_PTY_BINDING = 'node_modules/node-pty/build/Release/pty.node';

const LINUX_ELECTRON_NATIVE_ARTIFACTS = [
  LINUX_NODE_PTY_BINDING,
  'node_modules/better-sqlite3/build/Release/better_sqlite3.node',
];

module.exports = {
  LINUX_ELECTRON_NATIVE_ARTIFACTS,
  LINUX_NODE_PTY_BINDING,
};
