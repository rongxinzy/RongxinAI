import {
  artifactIdentity,
  loadTrustedReleaseKey,
  verifyEnvelope,
} from './update-manifest-lib.mjs';

const [expectedVersion, ...targets] = process.argv.slice(2);
if (!expectedVersion || targets.length === 0) {
  throw new Error(
    'usage: verify-published-update.mjs <version> <platform:arch:variant>...',
  );
}

const trustedKey = loadTrustedReleaseKey();
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

  const rangeResponse = await fetch(payload.artifact.url, {
    headers: { range: 'bytes=0-0' },
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  });
  await rangeResponse.body?.cancel();
  if (
    rangeResponse.status !== 206 ||
    rangeResponse.headers.get('content-range') !== `bytes 0-0/${payload.artifact.size}`
  ) {
    throw new Error(`${target} artifact did not satisfy the one-byte range smoke test`);
  }
  console.log(`[UpdateRelease] ${target} passed manifest and artifact smoke tests`);
}
