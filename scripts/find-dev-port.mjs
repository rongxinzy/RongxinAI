import net from 'node:net';

export const DEFAULT_DEV_PORT = 5175;
export const MAX_PORT_ATTEMPTS = 100;

/**
 * True when something already accepts connections on the port.
 * @param {number} port
 * @param {string} host
 * @returns {Promise<boolean>}
 */
function isPortAcceptingConnections(port, host) {
  return new Promise(resolve => {
    const socket = net.connect({ port, host });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => {
      socket.destroy();
      resolve(false);
    });
  });
}

/**
 * True when we can exclusively bind the port.
 * @param {number} port
 * @param {string} host
 * @returns {Promise<boolean>}
 */
function canBindPort(port, host) {
  return new Promise(resolve => {
    const server = net.createServer();
    server.unref();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(error => resolve(!error));
    });
    server.listen({ port, host, exclusive: true });
  });
}

/**
 * @param {number} port
 * @returns {Promise<boolean>}
 */
export async function isPortAvailable(port) {
  // Connect-check catches listeners that bind probes miss on Windows dual-stack.
  if (await isPortAcceptingConnections(port, '127.0.0.1')) return false;
  if (await isPortAcceptingConnections(port, '::1')) return false;
  if (!(await canBindPort(port, '0.0.0.0'))) return false;
  return true;
}

/**
 * Find the first free TCP port starting at `startPort`.
 * @param {number} [startPort=DEFAULT_DEV_PORT]
 * @param {number} [maxAttempts=MAX_PORT_ATTEMPTS]
 * @returns {Promise<number>}
 */
export async function findAvailablePort(
  startPort = DEFAULT_DEV_PORT,
  maxAttempts = MAX_PORT_ATTEMPTS,
) {
  const start = Number(startPort);
  if (!Number.isInteger(start) || start < 1 || start > 65535) {
    throw new Error(`Invalid start port: ${startPort}`);
  }

  for (let offset = 0; offset < maxAttempts; offset += 1) {
    const port = start + offset;
    if (port > 65535) break;
    if (await isPortAvailable(port)) {
      return port;
    }
  }

  throw new Error(
    `No available port found from ${start} within ${maxAttempts} attempts`,
  );
}

/**
 * Resolve the Vite/Electron shared port.
 * Honors VITE_DEV_PORT when set; otherwise starts at 5175 and increments.
 * @returns {Promise<number>}
 */
export async function resolveDevPort() {
  const preferred = Number(process.env.VITE_DEV_PORT ?? DEFAULT_DEV_PORT);
  return findAvailablePort(preferred);
}
