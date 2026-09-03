const { app, BrowserWindow } = require('electron');
const crypto = require('node:crypto');
const path = require('node:path');

const outputDirectory = process.env.REACT_COMPILER_EVALUATION_OUTPUT_DIR || 'dist';
const benchmarkFile = path.join(__dirname, outputDirectory, 'index.html');
const warmups = Number.parseInt(process.argv[2] || '10', 10);
const updates = Number.parseInt(process.argv[3] || '160', 10);
const runs = Number.parseInt(process.argv[4] || '30', 10);

async function main() {
  await app.whenReady();
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  await window.loadFile(benchmarkFile);
  const result = await window.webContents.executeJavaScript(
    `(() => {
      const result = [];
      for (let index = 0; index < ${runs}; index += 1) {
        const variant = index % 2 === 0 ? 'baseline' : 'compiler';
        result.push({ variant, value: window.reactCompilerBenchmark.run(variant, ${warmups}, ${updates}) });
      }
      return result;
    })()`,
    true,
  );

  const summarized = result.map(entry => ({
    durations: entry.value.commitDurations,
    textSha256: crypto.createHash('sha256').update(entry.value.text).digest('hex'),
    variant: entry.variant,
  }));
  process.stdout.write(`${JSON.stringify(summarized)}\n`);
  window.destroy();
  app.quit();
}

main().catch(error => {
  console.error(error);
  app.quit();
  process.exitCode = 1;
});
