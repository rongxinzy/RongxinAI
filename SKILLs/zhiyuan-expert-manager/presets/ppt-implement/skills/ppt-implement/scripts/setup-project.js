#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { resolveBrowserExecutable } = require('./browser-launch');

const SKILL_DIR = path.resolve(__dirname, '..');

function copyDirectory(source, destination) {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(destination, entry.name);
    if (entry.isDirectory()) {
      copyDirectory(sourcePath, destinationPath);
    } else {
      fs.copyFileSync(sourcePath, destinationPath);
    }
  }
}

function normalizeCommand(command, args) {
  if (process.platform !== 'win32' || !command.toLowerCase().endsWith('.cmd')) {
    return { command, args };
  }
  return {
    command: process.env.ComSpec || 'cmd.exe',
    args: ['/d', '/s', '/c', command, ...args],
  };
}

function runCommand(command, args, directory) {
  const normalized = normalizeCommand(command, args);
  const result = spawnSync(normalized.command, normalized.args, {
    cwd: directory,
    stdio: 'inherit',
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} failed in ${directory} with exit code ${result.status}`);
  }
}

function runNpmInstall(directory) {
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  console.log(`[PptSetup] installing dependencies in ${directory}`);
  runCommand(npmCommand, ['install', '--no-audit', '--no-fund'], directory);
}

function ensureBrowserAvailable(exportDirectory) {
  const playwrightEntry = require.resolve('playwright', { paths: [exportDirectory] });
  const { chromium } = require(playwrightEntry);
  const executablePath = resolveBrowserExecutable(chromium);
  if (!executablePath) {
    throw new Error(
      'PPT export requires Edge, Chrome, or Chromium; alternatively set PPT_BROWSER_EXECUTABLE.',
    );
  }
  console.log(`[PptSetup] using browser at ${executablePath}`);
}

function ensurePptProject(projectDirectory) {
  const projectFile = path.join(projectDirectory, 'docs', 'project.json');
  if (fs.existsSync(projectFile)) {
    const existing = JSON.parse(fs.readFileSync(projectFile, 'utf8'));
    if (existing.project_type && existing.project_type !== 'ppt') {
      throw new Error(`workspace already contains a non-PPT project: ${projectFile}`);
    }
    fs.writeFileSync(
      projectFile,
      JSON.stringify({ ...existing, project_type: 'ppt', sub_project_type: 'ppt' }, null, 2),
      'utf8',
    );
    return;
  }
  fs.writeFileSync(
    projectFile,
    JSON.stringify({ project_type: 'ppt', sub_project_type: 'ppt' }, null, 2),
    'utf8',
  );
}

function setup(projectDirectory, installDependencies = true) {
  const frontendTemplate = path.join(SKILL_DIR, 'templates', 'frontend');
  const frontendDirectory = path.join(projectDirectory, 'frontend');
  const exportDirectory = path.join(SKILL_DIR, 'scripts', 'export');

  if (!fs.existsSync(frontendTemplate)) {
    throw new Error(`frontend template not found: ${frontendTemplate}`);
  }

  fs.mkdirSync(projectDirectory, { recursive: true });
  fs.mkdirSync(path.join(projectDirectory, 'docs', 'product'), { recursive: true });
  fs.mkdirSync(path.join(projectDirectory, 'artifacts'), { recursive: true });

  if (!fs.existsSync(frontendDirectory)) {
    console.log(`[PptSetup] copying frontend template to ${frontendDirectory}`);
    copyDirectory(frontendTemplate, frontendDirectory);
  } else {
    console.log(`[PptSetup] preserving existing frontend at ${frontendDirectory}`);
  }

  fs.mkdirSync(path.join(frontendDirectory, 'src', 'slides'), { recursive: true });
  fs.mkdirSync(path.join(frontendDirectory, 'public', 'assets', 'images'), { recursive: true });
  ensurePptProject(projectDirectory);

  if (installDependencies) {
    runNpmInstall(frontendDirectory);
    runNpmInstall(exportDirectory);
    ensureBrowserAvailable(exportDirectory);
  }

  console.log(`[PptSetup] project is ready at ${projectDirectory}`);
}

function main() {
  const projectArgument = process.argv[2];
  if (!projectArgument) {
    console.error('Usage: node setup-project.js <workspace-dir> [--skip-install]');
    process.exit(1);
  }

  const projectDirectory = path.resolve(projectArgument);
  const installDependencies = !process.argv.includes('--skip-install');
  setup(projectDirectory, installDependencies);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error('[PptSetup] setup failed:', error);
    process.exit(1);
  }
}

module.exports = { setup };
