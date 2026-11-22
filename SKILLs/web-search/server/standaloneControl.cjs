'use strict';

const { randomBytes, timingSafeEqual } = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const PIPE_PREFIX = '\\\\.\\pipe\\zhiyuan-web-search-';
const SOCKET_DIRECTORY_PREFIX = 'zy-search-';
const SOCKET_NAME = 'stop.sock';
const CONTROL_FILE = '.server-control.local.json';
const DEFAULT_SERVER_URL = 'http://127.0.0.1:8923';
const ACKNOWLEDGED = 'stopped';

function isControlAddress(address) {
  if (typeof address !== 'string' || address.includes('\0')) return false;
  if (process.platform === 'win32') {
    return (
      address.startsWith(PIPE_PREFIX) && /^[a-f0-9]{32}$/.test(address.slice(PIPE_PREFIX.length))
    );
  }
  return (
    path.isAbsolute(address) &&
    path.basename(address) === SOCKET_NAME &&
    path.basename(path.dirname(address)).startsWith(SOCKET_DIRECTORY_PREFIX)
  );
}

/** @param {string} skillRoot @param {() => Promise<void>} stopBridge */
async function openStandaloneControl(skillRoot, stopBridge) {
  const root = fs.realpathSync(skillRoot);
  const marker = path.join(root, CONTROL_FILE);
  const directory =
    process.platform === 'win32'
      ? null
      : fs.mkdtempSync(path.join(os.tmpdir(), SOCKET_DIRECTORY_PREFIX));
  const address = directory
    ? path.join(directory, SOCKET_NAME)
    : PIPE_PREFIX + randomBytes(16).toString('hex');
  const secret = randomBytes(32).toString('hex');
  const published = JSON.stringify({ root, address, secret });
  const temporary = path.join(root, `.server-control-${secret.slice(0, 16)}.local.json`);
  let closed = false;
  const listener = net.createServer({ allowHalfOpen: true }, socket => {
    let input = '';
    socket.setEncoding('latin1');
    socket.setTimeout(1200, () => socket.destroy());
    socket.on('error', () => socket.destroy());
    socket.on('data', chunk => {
      input += chunk;
      if (input.length > secret.length) socket.destroy();
    });
    socket.on('end', () => {
      if (
        closed ||
        input.length !== secret.length ||
        !timingSafeEqual(Buffer.from(input, 'latin1'), Buffer.from(secret))
      ) {
        socket.end();
        return;
      }
      socket.setTimeout(0);
      close();
      void stopBridge().then(
        () => socket.end(ACKNOWLEDGED),
        () => socket.end(),
      );
    });
  });

  function close() {
    if (closed) return;
    closed = true;
    listener.close();
    if (directory) fs.rmSync(directory, { recursive: true, force: true });
    try {
      if (fs.readFileSync(marker, 'utf8') === published) fs.unlinkSync(marker);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }

  try {
    await new Promise((resolve, reject) => {
      listener.once('error', reject);
      listener.listen(address, () => {
        listener.removeListener('error', reject);
        resolve(undefined);
      });
    });
    fs.writeFileSync(temporary, published, { mode: 0o600, flag: 'wx' });
    fs.renameSync(temporary, marker);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    close();
    throw error;
  }
  return close;
}

/** @param {string} skillRoot */
async function stopStandaloneBridge(skillRoot) {
  let state;
  let root;
  try {
    root = fs.realpathSync(skillRoot);
    state = JSON.parse(fs.readFileSync(path.join(root, CONTROL_FILE), 'utf8'));
  } catch {
    return false;
  }
  if (
    state?.root !== root ||
    !isControlAddress(state.address) ||
    typeof state.secret !== 'string' ||
    !/^[a-f0-9]{64}$/.test(state.secret)
  )
    return false;
  return new Promise(resolve => {
    const socket = net.createConnection(state.address, () => socket.end(state.secret));
    let response = '';
    socket.setEncoding('ascii');
    socket.setTimeout(8000, () => socket.destroy());
    socket.on('error', () => socket.destroy());
    socket.on('data', chunk => {
      response += chunk;
      if (response.length > ACKNOWLEDGED.length) socket.destroy();
    });
    socket.on('close', () => resolve(response === ACKNOWLEDGED));
  });
}

module.exports = { CONTROL_FILE, DEFAULT_SERVER_URL, openStandaloneControl, stopStandaloneBridge };
