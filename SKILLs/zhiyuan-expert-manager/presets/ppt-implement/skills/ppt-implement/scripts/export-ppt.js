#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { syncProject } = require('./post-slide');

function runCommand(command, args, directory) {
  return new Promise((resolve, reject) => {
    console.log(`[PptExport] running ${command} ${args.join(' ')}`);
    const isWindowsCommand = process.platform === 'win32' && command.toLowerCase().endsWith('.cmd');
    const executable = isWindowsCommand ? process.env.ComSpec || 'cmd.exe' : command;
    const executableArgs = isWindowsCommand ? ['/d', '/s', '/c', command, ...args] : args;
    const child = spawn(executable, executableArgs, {
      cwd: directory,
      stdio: 'inherit',
      shell: false,
    });
    child.once('error', reject);
    child.once('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

function assertNonemptyFile(filePath) {
  if (!fs.existsSync(filePath) || fs.statSync(filePath).size === 0) {
    throw new Error(`expected nonempty output file: ${filePath}`);
  }
}

async function exportPresentation(projectDirectory) {
  const slides = syncProject(projectDirectory);
  if (slides.length === 0) throw new Error('no slide-N.js files were found');

  const frontendDirectory = path.join(projectDirectory, 'frontend');
  const artifactsDirectory = path.join(projectDirectory, 'artifacts');
  const staticSlidesDirectory = path.join(frontendDirectory, 'dist-slides');
  const mergedSlidesFile = path.join(staticSlidesDirectory, 'all-slides.html');
  const pptxFile = path.join(artifactsDirectory, 'presentation.pptx');
  const htmlArtifact = path.join(artifactsDirectory, 'index.html');
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const converter = path.join(__dirname, 'export', 'html2pptx.js');

  fs.mkdirSync(artifactsDirectory, { recursive: true });
  fs.rmSync(htmlArtifact, { force: true });
  fs.rmSync(pptxFile, { force: true });
  try {
    await runCommand(npmCommand, ['run', 'build'], frontendDirectory);
    await runCommand(npmCommand, ['run', 'build:slides'], frontendDirectory);
    assertNonemptyFile(mergedSlidesFile);
    await runCommand(process.execPath, [converter, mergedSlidesFile, pptxFile], projectDirectory);
    assertNonemptyFile(htmlArtifact);
    assertNonemptyFile(pptxFile);
  } finally {
    fs.rmSync(staticSlidesDirectory, { recursive: true, force: true });
  }

  console.log(`[PptExport] HTML artifact: ${htmlArtifact}`);
  console.log(`[PptExport] PPTX artifact: ${pptxFile}`);
  return { htmlArtifact, pptxFile };
}

async function main() {
  const projectArgument = process.argv[2];
  if (!projectArgument) {
    console.error('Usage: node export-ppt.js <workspace-dir>');
    process.exit(1);
  }
  await exportPresentation(path.resolve(projectArgument));
}

if (require.main === module) {
  main().catch(error => {
    console.error('[PptExport] export failed:', error);
    process.exit(1);
  });
}

module.exports = { exportPresentation };
