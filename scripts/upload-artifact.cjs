#!/usr/bin/env node
/**
 * Upload artifact to JFrog Artifactory.
 *
 * Usage:
 *   node scripts/upload-artifact.cjs <local-file> <remote-path> [repo]
 *
 * Environment variables:
 *   FROG_HOST    - JFrog host (default: 172.18.5.249)
 *   FROG_PORT    - JFrog port (default: 8081)
 *   FROG_NAME    - JFrog username (required)
 *   FROG_PW      - JFrog password or API key (required)
 *   FROG_REPO    - Target repository (default: generic-local)
 *   ALL_PROXY    - Optional proxy (e.g. socks5h://localhost:1055)
 *   HTTP_PROXY   - Optional HTTP proxy
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function uploadArtifact(localPath, remotePath, options = {}) {
  const frogHost = options.host || process.env.FROG_HOST || '172.18.5.249';
  const frogPort = options.port || process.env.FROG_PORT || '8081';
  const frogName = options.username || process.env.FROG_NAME;
  const frogPw = options.password || process.env.FROG_PW;
  const repo = options.repo || process.env.FROG_REPO || 'generic-local';

  if (!frogName || !frogPw) {
    throw new Error('Missing required credentials: FROG_NAME and FROG_PW must be set');
  }

  const resolvedLocal = path.resolve(localPath);
  if (!fs.existsSync(resolvedLocal)) {
    throw new Error(`Local file not found: ${resolvedLocal}`);
  }

  // Normalize remote path (remove leading slash)
  const normalizedRemote = remotePath.replace(/^\/+/, '');
  const url = `http://${frogHost}:${frogPort}/artifactory/${repo}/${normalizedRemote}`;

  console.log(`[upload-artifact] Uploading ${resolvedLocal} -> ${url}`);

  const proxyEnv = process.env.ALL_PROXY || process.env.HTTP_PROXY || '';
  if (proxyEnv) {
    console.log(`[upload-artifact] Using proxy: ${proxyEnv}`);
  }

  const curlArgs = [
    '-f', // fail on HTTP error
    '-sS', // silent but show errors
    '-u',
    `${frogName}:${frogPw}`,
    '-T',
    resolvedLocal,
    '-H',
    'X-Checksum-Deploy:false',
  ];

  // Explicitly pass proxy if set, to ensure curl uses it
  const proxy = process.env.ALL_PROXY || process.env.HTTP_PROXY || process.env.http_proxy || '';
  if (proxy) {
    curlArgs.push('--proxy', proxy);
  }

  curlArgs.push(url);

  const cmd = `curl ${curlArgs.map(a => `"${a}"`).join(' ')}`;
  execSync(cmd, { stdio: 'inherit', env: process.env });

  console.log('[upload-artifact] Upload successful');
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error('Usage: node upload-artifact.cjs <local-file> <remote-path> [repo]');
    console.error('');
    console.error('Examples:');
    console.error('  node upload-artifact.cjs dist/app.zip releases/app-latest.zip');
    console.error(
      '  node upload-artifact.cjs dist/app.zip releases/app-latest.zip libs-release-local',
    );
    process.exit(1);
  }

  const [localFile, remotePath, repo] = args;
  try {
    uploadArtifact(localFile, remotePath, { repo });
  } catch (err) {
    console.error(`[upload-artifact] Failed: ${err.message}`);
    process.exit(1);
  }
}

module.exports = { uploadArtifact };
