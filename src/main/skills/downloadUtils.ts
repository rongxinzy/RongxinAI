import { spawn } from 'child_process';
import { session } from 'electron';
import extractZip from 'extract-zip';
import fs from 'fs';
import JSZip from 'jszip';
import path from 'path';

import { NpmCli, resolveBundledNpmRuntime } from '../libs/npmRuntime';
import { extractErrorMessage } from './processRunner';
import type { GithubRepoSource } from './gitUtils';

export const downloadGithubArchive = async (
  source: GithubRepoSource,
  tempRoot: string,
  ref?: string,
): Promise<string> => {
  const encodedRef = ref ? encodeURIComponent(ref) : '';
  const archiveUrlCandidates: Array<{ url: string; headers: Record<string, string> }> = [];

  if (encodedRef) {
    archiveUrlCandidates.push(
      {
        url: `https://github.com/${source.owner}/${source.repo}/archive/refs/heads/${encodedRef}.zip`,
        headers: { 'User-Agent': 'ZhiYuanAgent Skill Downloader' },
      },
      {
        url: `https://github.com/${source.owner}/${source.repo}/archive/refs/tags/${encodedRef}.zip`,
        headers: { 'User-Agent': 'ZhiYuanAgent Skill Downloader' },
      },
      {
        url: `https://github.com/${source.owner}/${source.repo}/archive/${encodedRef}.zip`,
        headers: { 'User-Agent': 'ZhiYuanAgent Skill Downloader' },
      },
    );
  }

  archiveUrlCandidates.push({
    url: `https://api.github.com/repos/${source.owner}/${source.repo}/zipball${encodedRef ? `/${encodedRef}` : ''}`,
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'ZhiYuanAgent Skill Downloader',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  let buffer: Buffer | null = null;
  let lastError: string | null = null;

  for (const candidate of archiveUrlCandidates) {
    try {
      const response = await session.defaultSession.fetch(candidate.url, {
        method: 'GET',
        headers: candidate.headers,
      });

      if (!response.ok) {
        const detail = (await response.text()).trim();
        lastError = `Archive download failed (${response.status} ${response.statusText})${detail ? `: ${detail}` : ''}`;
        continue;
      }

      buffer = Buffer.from(await response.arrayBuffer());
      break;
    } catch (error) {
      lastError = extractErrorMessage(error);
    }
  }

  if (!buffer) {
    throw new Error(lastError || 'Archive download failed');
  }

  const zipPath = path.join(tempRoot, 'github-archive.zip');
  const extractRoot = path.join(tempRoot, 'github-archive');
  fs.writeFileSync(zipPath, buffer);
  fs.mkdirSync(extractRoot, { recursive: true });
  await extractZip(zipPath, { dir: extractRoot });

  const extractedDirs = fs
    .readdirSync(extractRoot)
    .map(entry => path.join(extractRoot, entry))
    .filter(entryPath => {
      try {
        return fs.statSync(entryPath).isDirectory();
      } catch {
        return false;
      }
    });

  if (extractedDirs.length === 1) {
    return extractedDirs[0];
  }

  return extractRoot;
};

/**
 * Check if a source string looks like an npm package spec.
 * Supports: package-name, @scope/package, package@version, @scope/package@version
 */
export const isNpmPackageSpec = (source: string): boolean => {
  // Must not be a local path, URL, or GitHub shorthand (owner/repo)
  if (source.startsWith('.') || source.startsWith('/') || source.startsWith('~')) return false;
  try {
    new URL(source);
    return false;
  } catch {
    /* not a URL, good */
  }

  // Scoped package: @scope/name or @scope/name@version
  if (/^@[\w-]+\/[\w.-]+(@[\w.^~>=<*-]+)?$/.test(source)) return true;
  // Unscoped package: name or name@version (must not contain '/' which would be owner/repo)
  if (/^[\w.-]+(@[\w.^~>=<*-]+)?$/.test(source) && !source.includes('/')) return true;

  return false;
};

/**
 * Download and extract an npm package using `npm pack`.
 * The tarball is extracted into the managed plugin directory.
 */
export const downloadNpmPackage = async (spec: string, tempRoot: string): Promise<string> => {
  const bundledNpm = resolveBundledNpmRuntime(NpmCli.Npm, [
    'pack',
    spec,
    '--ignore-scripts',
    '--json',
  ]);
  if (!bundledNpm)
    throw new Error('Bundled npm runtime is unavailable. Please reinstall the application.');

  const packResult = await new Promise<{ code: number; stdout: string; stderr: string }>(
    resolve => {
      const child = spawn(bundledNpm.command, bundledNpm.args, {
        cwd: tempRoot,
        env: bundledNpm.env,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', data => {
        stdout += data;
      });
      child.stderr.on('data', data => {
        stderr += data;
      });
      child.on('close', code => resolve({ code: code ?? 1, stdout, stderr }));
      child.on('error', err => resolve({ code: 1, stdout: '', stderr: err.message }));
    },
  );

  if (packResult.code !== 0) {
    const detail = packResult.stderr.trim() || packResult.stdout.trim();
    throw new Error(`npm pack failed for "${spec}": ${detail}`);
  }

  // Find the .tgz file
  const tgzFiles = fs.readdirSync(tempRoot).filter(f => f.endsWith('.tgz'));
  if (tgzFiles.length === 0) {
    // Try parsing JSON output for filename
    try {
      const parsed = JSON.parse(packResult.stdout);
      const entries = Array.isArray(parsed) ? parsed : [parsed];
      for (const entry of entries) {
        if (entry.filename && fs.existsSync(path.join(tempRoot, entry.filename))) {
          tgzFiles.push(entry.filename);
          break;
        }
      }
    } catch {
      /* ignore */
    }
  }

  if (tgzFiles.length === 0) {
    throw new Error(`npm pack produced no .tgz archive for "${spec}"`);
  }

  // Extract .tgz (which is a gzip'd tar containing a 'package/' directory)
  const tgzPath = path.join(tempRoot, tgzFiles[0]);
  const extractDir = path.join(tempRoot, 'npm-extracted');
  fs.mkdirSync(extractDir, { recursive: true });

  // Use tar to extract (Node.js built-in zlib + tar via npm's own bundled tar)
  const tarExtract = await new Promise<{ code: number; stderr: string }>(resolve => {
    // Use system tar (available on all platforms including Windows 10+)
    const child = spawn('tar', ['xzf', tgzPath, '-C', extractDir], {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', data => {
      stderr += data;
    });
    child.on('close', code => resolve({ code: code ?? 1, stderr }));
    child.on('error', () => resolve({ code: 1, stderr: 'tar not found' }));
  });

  if (tarExtract.code !== 0) {
    throw new Error(`Failed to extract npm package: ${tarExtract.stderr}`);
  }

  // npm pack extracts to a 'package/' subdirectory
  const packageDir = path.join(extractDir, 'package');
  if (fs.existsSync(packageDir)) {
    return packageDir;
  }

  // Fallback: return first directory in extract dir
  const dirs = fs
    .readdirSync(extractDir)
    .map(name => path.join(extractDir, name))
    .filter(p => fs.statSync(p).isDirectory());
  return dirs[0] || extractDir;
};

export const isRemoteZipUrl = (source: string): boolean => {
  try {
    const url = new URL(source);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      (url.pathname.toLowerCase().endsWith('.zip') ||
        (url.hostname.toLowerCase().endsWith('modelscope.cn') &&
          /\/skills\/[^/]+\/[^/]+\/archive\/zip\//i.test(url.pathname)))
    );
  } catch {
    return false;
  }
};

export const downloadZipUrl = async (zipUrl: string, tempRoot: string): Promise<string> => {
  const response = await session.defaultSession.fetch(zipUrl, {
    method: 'GET',
    headers: { 'User-Agent': 'ZhiYuanAgent Skill Downloader' },
  });

  if (!response.ok) {
    throw new Error(`Download failed (${response.status} ${response.statusText})`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const zipPath = path.join(tempRoot, 'remote-skill.zip');
  const extractRoot = path.join(tempRoot, 'remote-skill');
  fs.writeFileSync(zipPath, buffer);
  fs.mkdirSync(extractRoot, { recursive: true });
  try {
    await extractZip(zipPath, { dir: extractRoot });
  } catch (error) {
    if (!zipUrl.includes('modelscope.cn/skills/')) throw error;
    console.warn(
      '[SkillManager] standard ZIP extraction failed, using ModelScope-compatible parser',
    );
    await extractModelScopeZip(buffer, extractRoot);
  }

  const extractedDirs = fs
    .readdirSync(extractRoot)
    .map(entry => path.join(extractRoot, entry))
    .filter(entryPath => {
      try {
        return fs.statSync(entryPath).isDirectory();
      } catch {
        return false;
      }
    });

  if (extractedDirs.length === 1) {
    return extractedDirs[0];
  }

  return extractRoot;
};

async function extractModelScopeZip(buffer: Buffer, destination: string): Promise<void> {
  const archive = await JSZip.loadAsync(buffer);
  for (const [entryName, entry] of Object.entries(archive.files)) {
    const normalized = entryName.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!normalized || normalized.split('/').some(part => part === '..')) continue;
    const target = path.resolve(destination, normalized);
    if (!target.startsWith(path.resolve(destination) + path.sep)) continue;
    if (entry.dir) {
      fs.mkdirSync(target, { recursive: true });
      continue;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, await entry.async('nodebuffer'));
  }
}
