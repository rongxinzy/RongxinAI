import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { inflateSync } from 'node:zlib';

const [executablePath, screenshotPath = 'release/linux-render-smoke.png'] =
  process.argv.slice(2);
if (!executablePath) {
  throw new Error(
    'usage: verify-linux-renderer.mjs <linux-unpacked-executable> [screenshot-output]',
  );
}

const remoteDebuggingPort = 9222;
let applicationOutput = '';

const application = spawn(
  'xvfb-run',
  ['-a', executablePath, `--remote-debugging-port=${remoteDebuggingPort}`],
  {
    detached: true,
    env: {
      ...process.env,
      ELECTRON_ENABLE_LOGGING: 'true',
      ZHIYUAN_ENABLE_GPU: 'false',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);

for (const stream of [application.stdout, application.stderr]) {
  stream?.on('data', chunk => {
    applicationOutput = `${applicationOutput}${chunk.toString()}`.slice(-20_000);
  });
}

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function waitForPageTarget() {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (application.exitCode !== null) {
      throw new Error(`Linux application exited before rendering:\n${applicationOutput}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${remoteDebuggingPort}/json/list`, {
        signal: AbortSignal.timeout(1_500),
      });
      if (response.ok) {
        const targets = await response.json();
        const page = targets.find(
          target =>
            target.type === 'page' &&
            typeof target.webSocketDebuggerUrl === 'string' &&
            typeof target.url === 'string' &&
            target.url.startsWith('file:'),
        );
        if (page) return page;
      }
    } catch {
      // The DevTools endpoint is expected to be unavailable while Electron starts.
    }
    await delay(500);
  }
  throw new Error(`Timed out waiting for the Linux renderer:\n${applicationOutput}`);
}

function connectToDevTools(webSocketDebuggerUrl) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(webSocketDebuggerUrl);
    const pending = new Map();
    let sequence = 0;

    socket.addEventListener('open', () => {
      resolve({
        send(method, params = {}) {
          const id = (sequence += 1);
          socket.send(JSON.stringify({ id, method, params }));
          return new Promise((resolveCommand, rejectCommand) => {
            pending.set(id, { resolve: resolveCommand, reject: rejectCommand });
          });
        },
        close() {
          socket.close();
        },
      });
    });
    socket.addEventListener('message', event => {
      const message = JSON.parse(String(event.data));
      if (!message.id || !pending.has(message.id)) return;
      const command = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) {
        command.reject(new Error(message.error.message));
      } else {
        command.resolve(message.result);
      }
    });
    socket.addEventListener('error', () => reject(new Error('DevTools WebSocket failed')));
  });
}

async function waitForRenderedContent(devTools) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const evaluation = await devTools.send('Runtime.evaluate', {
      expression: `(() => {
        const root = document.getElementById('root');
        return {
          readyState: document.readyState,
          rootChildren: root?.childElementCount ?? 0,
          text: document.body?.innerText?.trim().slice(0, 500) ?? ''
        };
      })()`,
      returnByValue: true,
    });
    const state = evaluation.result?.value;
    if (state?.readyState === 'complete' && state.rootChildren > 0 && state.text.length >= 10) {
      return state;
    }
    await delay(500);
  }
  throw new Error(`Renderer loaded but did not show application content:\n${applicationOutput}`);
}

function paethPredictor(left, above, upperLeft) {
  const estimate = left + above - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const aboveDistance = Math.abs(estimate - above);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) return left;
  return aboveDistance <= upperLeftDistance ? above : upperLeft;
}

function analyzeScreenshot(png) {
  const signature = png.subarray(0, 8).toString('hex');
  if (signature !== '89504e470d0a1a0a') throw new Error('DevTools returned an invalid PNG');

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const imageDataChunks = [];

  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.subarray(offset + 4, offset + 8).toString('ascii');
    const data = png.subarray(offset + 8, offset + 8 + length);
    offset += length + 12;
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') {
      imageDataChunks.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }

  const bytesPerPixel = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (!width || !height || bitDepth !== 8 || !bytesPerPixel || interlace !== 0) {
    throw new Error(
      `Unsupported screenshot PNG format: ${width}x${height}, depth=${bitDepth}, color=${colorType}, interlace=${interlace}`,
    );
  }

  const inflated = inflateSync(Buffer.concat(imageDataChunks));
  const rowLength = width * bytesPerPixel;
  const previous = Buffer.alloc(rowLength);
  const current = Buffer.alloc(rowLength);
  const distinctColors = new Set();
  let darkSamples = 0;
  let samples = 0;
  let inputOffset = 0;

  for (let y = 0; y < height; y += 1) {
    const filter = inflated[inputOffset];
    inputOffset += 1;
    for (let x = 0; x < rowLength; x += 1) {
      const encoded = inflated[inputOffset + x];
      const left = x >= bytesPerPixel ? current[x - bytesPerPixel] : 0;
      const above = previous[x];
      const upperLeft = x >= bytesPerPixel ? previous[x - bytesPerPixel] : 0;
      if (filter === 0) current[x] = encoded;
      else if (filter === 1) current[x] = (encoded + left) & 0xff;
      else if (filter === 2) current[x] = (encoded + above) & 0xff;
      else if (filter === 3) current[x] = (encoded + Math.floor((left + above) / 2)) & 0xff;
      else if (filter === 4) {
        current[x] = (encoded + paethPredictor(left, above, upperLeft)) & 0xff;
      } else {
        throw new Error(`Unsupported PNG row filter: ${filter}`);
      }
    }
    inputOffset += rowLength;

    if (y % 8 === 0) {
      for (let x = 0; x < width; x += 8) {
        const pixelOffset = x * bytesPerPixel;
        const red = current[pixelOffset];
        const green = current[pixelOffset + 1];
        const blue = current[pixelOffset + 2];
        distinctColors.add(`${red >> 4}:${green >> 4}:${blue >> 4}`);
        if (red < 235 || green < 235 || blue < 235) darkSamples += 1;
        samples += 1;
      }
    }
    current.copy(previous);
  }

  return {
    width,
    height,
    distinctColors: distinctColors.size,
    nonWhiteRatio: samples ? darkSamples / samples : 0,
  };
}

async function stopApplication() {
  if (!application.pid || application.exitCode !== null) return;
  try {
    process.kill(-application.pid, 'SIGTERM');
  } catch {
    // The application may already have exited after the smoke test.
  }
  await Promise.race([new Promise(resolve => application.once('exit', resolve)), delay(5_000)]);
  if (application.exitCode === null) {
    try {
      process.kill(-application.pid, 'SIGKILL');
    } catch {
      // Ignore a race with normal shutdown.
    }
  }
}

let devTools;
try {
  const page = await waitForPageTarget();
  devTools = await connectToDevTools(page.webSocketDebuggerUrl);
  await devTools.send('Page.enable');
  const renderedState = await waitForRenderedContent(devTools);
  const screenshot = await devTools.send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: false,
  });
  const screenshotBytes = Buffer.from(screenshot.data, 'base64');
  const screenshotAnalysis = analyzeScreenshot(screenshotBytes);
  if (screenshotAnalysis.distinctColors < 8 || screenshotAnalysis.nonWhiteRatio < 0.01) {
    throw new Error(
      `Linux renderer screenshot appears blank: ${JSON.stringify(screenshotAnalysis)}`,
    );
  }

  await fs.mkdir(path.dirname(screenshotPath), { recursive: true });
  await fs.writeFile(screenshotPath, screenshotBytes);
  console.log(
    `[LinuxRendererSmoke] rendered ${renderedState.rootChildren} root element(s) with visible text; screenshot ${screenshotAnalysis.width}x${screenshotAnalysis.height}, ${screenshotAnalysis.distinctColors} sampled colors`,
  );
} finally {
  devTools?.close();
  await stopApplication();
}
