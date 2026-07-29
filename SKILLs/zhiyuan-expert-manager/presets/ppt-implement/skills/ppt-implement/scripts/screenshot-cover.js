#!/usr/bin/env node

const fs = require('fs');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const { browserLaunchOptions } = require('./browser-launch');
const { listSlides } = require('./post-slide');

function findAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

async function waitForServer(url, child) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null)
      throw new Error(`preview server exited with code ${child.exitCode}`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The preview process may still be starting.
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`preview server did not become ready: ${url}`);
}

function loadPlaywright() {
  const playwrightEntry = path.join(__dirname, 'export', 'node_modules', 'playwright');
  if (!fs.existsSync(playwrightEntry)) {
    throw new Error('Playwright is not installed; rerun setup-project.js without --skip-install');
  }
  return require(playwrightEntry);
}

async function capturePresentation(projectDirectory) {
  const frontendDirectory = path.join(projectDirectory, 'frontend');
  const artifactsDirectory = path.join(projectDirectory, 'artifacts');
  const artifactIndex = path.join(artifactsDirectory, 'index.html');
  const slides = listSlides(path.join(frontendDirectory, 'src', 'slides'));
  const viteCli = path.join(frontendDirectory, 'node_modules', 'vite', 'bin', 'vite.js');
  if (!fs.existsSync(artifactIndex)) throw new Error(`build artifact not found: ${artifactIndex}`);
  if (slides.length === 0) throw new Error('no slide-N.js files were found');
  if (!fs.existsSync(viteCli)) throw new Error('Vite is not installed; rerun setup-project.js');

  const { chromium } = loadPlaywright();
  const port = await findAvailablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const preview = spawn(
    process.execPath,
    [
      viteCli,
      'preview',
      '--outDir',
      artifactsDirectory,
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '--strictPort',
    ],
    { cwd: frontendDirectory, stdio: ['ignore', 'ignore', 'inherit'], shell: false },
  );
  let browser;
  try {
    await waitForServer(baseUrl, preview);
    browser = await chromium.launch(browserLaunchOptions(chromium));
    const page = await browser.newPage({ viewport: { width: 1440, height: 810 } });
    const outputDirectory = path.join(projectDirectory, 'artifacts', 'screenshots');
    fs.rmSync(outputDirectory, { recursive: true, force: true });
    fs.mkdirSync(outputDirectory, { recursive: true });

    for (const { pageNumber } of slides) {
      await page.goto(`${baseUrl}/index.html?page=${pageNumber}`, { waitUntil: 'networkidle' });
      const viewport = page.locator('#ppt-viewport');
      const outputFile = path.join(outputDirectory, `page-${pageNumber}.png`);
      if (await viewport.count()) await viewport.screenshot({ path: outputFile });
      else await page.screenshot({ path: outputFile, fullPage: false });
      if (!fs.existsSync(outputFile) || fs.statSync(outputFile).size === 0) {
        throw new Error(`screenshot was not created: ${outputFile}`);
      }
    }
    console.log(`[PptScreenshot] captured ${slides.length} page(s) in ${outputDirectory}`);
    return outputDirectory;
  } finally {
    if (browser) await browser.close();
    preview.kill();
  }
}

async function main() {
  const projectArgument = process.argv[2];
  if (!projectArgument) {
    console.error('Usage: node screenshot-cover.js <workspace-dir>');
    process.exit(1);
  }
  await capturePresentation(path.resolve(projectArgument));
}

if (require.main === module) {
  main().catch(error => {
    console.error('[PptScreenshot] screenshot capture failed:', error);
    process.exit(1);
  });
}

module.exports = { capturePresentation };
