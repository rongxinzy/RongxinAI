import {
  artifactIdentity,
  loadTrustedReleaseKey,
  verifyEnvelope,
} from './update-manifest-lib.mjs';
import {
  fetchOneByteRange,
  redirectMatches,
  verifyPublishedBlockmap,
} from './published-update-smoke-lib.mjs';
import yaml from 'js-yaml';

const [expectedVersion, ...targets] = process.argv.slice(2);
if (!expectedVersion || targets.length === 0) {
  throw new Error(
    'usage: verify-published-update.mjs <version> <platform:arch:variant>...',
  );
}

const trustedKey = loadTrustedReleaseKey();
const payloadByTarget = new Map();
for (const target of targets) {
  const [platform, arch, variant] = target.split(':');
  if (!platform || !arch || !variant) throw new Error(`Invalid update target: ${target}`);

  const endpoint = new URL('https://updates.rongxzyai.com/v1/updates/latest');
  endpoint.searchParams.set('channel', 'stable');
  endpoint.searchParams.set('platform', platform);
  endpoint.searchParams.set('arch', arch);
  endpoint.searchParams.set('variant', variant);

  const manifestResponse = await fetch(endpoint, {
    headers: { accept: 'application/json', 'cache-control': 'no-cache' },
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  });
  if (!manifestResponse.ok) {
    throw new Error(`${target} manifest returned HTTP ${manifestResponse.status}`);
  }

  const payload = verifyEnvelope(await manifestResponse.json(), trustedKey);
  if (payload.version !== expectedVersion) {
    throw new Error(
      `${target} returned version ${payload.version}; expected ${expectedVersion}`,
    );
  }
  const identity = artifactIdentity(payload);
  if (identity.target !== target) {
    throw new Error(`${target} returned artifact metadata for ${identity.target}`);
  }
  payloadByTarget.set(target, payload);

  const headResponse = await fetch(payload.artifact.url, {
    method: 'HEAD',
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  });
  if (!headResponse.ok) {
    throw new Error(`${target} artifact HEAD returned HTTP ${headResponse.status}`);
  }
  if (Number(headResponse.headers.get('content-length')) !== payload.artifact.size) {
    throw new Error(`${target} artifact size does not match the signed manifest`);
  }

  const rangeResponse = await fetchOneByteRange({ url: payload.artifact.url });
  await rangeResponse.body?.cancel();
  if (
    rangeResponse.status !== 206 ||
    rangeResponse.headers.get('content-range') !== `bytes 0-0/${payload.artifact.size}`
  ) {
    throw new Error(`${target} artifact did not satisfy the one-byte range smoke test`);
  }
  console.log(`[UpdateRelease] ${target} passed manifest and artifact smoke tests`);
}

const electronMetadataNames = new Map([
  ['win32:x64:lite', 'latest.yml'],
  ['darwin:arm64:default', 'latest-mac.yml'],
  ['linux:x64:appimage', 'latest-linux.yml'],
  ['linux:x64:deb', 'latest-linux.yml'],
]);
for (const target of targets) {
  const [platform, arch, variant] = target.split(':');
  const metadataName = electronMetadataNames.get(target);
  if (!metadataName) continue;
  const endpoint = new URL(
    `https://updates.rongxzyai.com/v2/electron/stable/${platform}/${arch}/${variant}/${metadataName}`,
  );
  const response = await fetch(endpoint, {
    headers: { accept: 'application/x-yaml', 'cache-control': 'no-cache' },
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  });
  const metadataText = await response.text();
  if (!response.ok) {
    throw new Error(`${target} electron-updater metadata is unavailable or has the wrong version`);
  }
  const metadata = yaml.load(metadataText);
  if (
    !metadata ||
    typeof metadata !== 'object' ||
    Array.isArray(metadata) ||
    metadata.version !== expectedVersion ||
    !Array.isArray(metadata.files) ||
    metadata.files.length !== 1
  ) {
    throw new Error(`${target} electron-updater metadata is invalid or has the wrong version`);
  }
  const [file] = metadata.files;
  const signedUpdater = payloadByTarget.get(target)?.artifact?.updater;
  if (
    !file ||
    typeof file.url !== 'string' ||
    typeof file.sha512 !== 'string' ||
    metadata.path !== file.url ||
    metadata.sha512 !== file.sha512 ||
    !signedUpdater ||
    file.sha512 !== signedUpdater.sha512
  ) {
    throw new Error(`${target} electron-updater metadata does not match the signed manifest`);
  }
  const updaterUrl = new URL(file.url);
  const expectedPrefix = `/v2/electron/releases/${expectedVersion}/${platform}/${arch}/${variant}/`;
  if (
    updaterUrl.origin !== 'https://updates.rongxzyai.com' ||
    !updaterUrl.pathname.startsWith(expectedPrefix) ||
    decodeURIComponent(updaterUrl.pathname.slice(expectedPrefix.length)) !== signedUpdater.filename
  ) {
    throw new Error(`${target} electron-updater URL is not versioned through the Worker`);
  }
  const redirectResponse = await fetch(updaterUrl, {
    method: 'HEAD',
    redirect: 'manual',
    signal: AbortSignal.timeout(15_000),
  });
  const location = redirectResponse.headers.get('location');
  if (
    ![301, 302, 307, 308].includes(redirectResponse.status) ||
    !location ||
    !redirectMatches(location, updaterUrl, signedUpdater.url)
  ) {
    throw new Error(`${target} electron-updater artifact did not redirect to the immutable download`);
  }

  const updaterHeadResponse = await fetch(signedUpdater.url, {
    method: 'HEAD',
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  });
  if (
    !updaterHeadResponse.ok ||
    Number(updaterHeadResponse.headers.get('content-length')) !== signedUpdater.size
  ) {
    throw new Error(`${target} updater artifact size does not match the signed manifest`);
  }
  const updaterRangeResponse = await fetchOneByteRange({ url: signedUpdater.url });
  await updaterRangeResponse.body?.cancel();
  if (
    updaterRangeResponse.status !== 206 ||
    updaterRangeResponse.headers.get('content-range') !== `bytes 0-0/${signedUpdater.size}`
  ) {
    throw new Error(`${target} updater artifact did not satisfy the one-byte range smoke test`);
  }
  await verifyPublishedBlockmap({
    target,
    updaterUrl,
    immutableUpdaterUrl: new URL(signedUpdater.url),
    updaterFilename: signedUpdater.filename,
  });
  console.log(`[UpdateRelease] ${target} passed electron-updater feed smoke test`);
}
