const REDIRECT_STATUSES = new Set([301, 302, 307, 308]);
export const ONE_BYTE_RANGE_HEADERS = Object.freeze({
  range: 'bytes=0-0',
  'cache-control': 'no-cache',
});

export function redirectMatches(location, baseUrl, expectedUrl) {
  try {
    return new URL(location, baseUrl).toString() === new URL(expectedUrl).toString();
  } catch {
    return false;
  }
}

export async function verifyPublishedBlockmap({
  fetchImpl = fetch,
  target,
  updaterUrl,
  immutableUpdaterUrl,
  updaterFilename,
  timeoutMs = 15_000,
}) {
  if (!/\.(?:exe|zip)$/i.test(updaterFilename)) return false;

  const blockmapUrl = new URL(`${updaterUrl.toString()}.blockmap`);
  const immutableBlockmapUrl = new URL(`${immutableUpdaterUrl.toString()}.blockmap`);
  const redirectResponse = await fetchImpl(blockmapUrl, {
    method: 'HEAD',
    redirect: 'manual',
    signal: AbortSignal.timeout(timeoutMs),
  });
  const location = redirectResponse.headers.get('location');
  if (
    !REDIRECT_STATUSES.has(redirectResponse.status) ||
    !location ||
    !redirectMatches(location, blockmapUrl, immutableBlockmapUrl)
  ) {
    throw new Error(`${target} blockmap did not redirect to the immutable download`);
  }

  const headResponse = await fetchImpl(immutableBlockmapUrl, {
    method: 'HEAD',
    redirect: 'error',
    signal: AbortSignal.timeout(timeoutMs),
  });
  const size = Number(headResponse.headers.get('content-length'));
  if (!headResponse.ok || !Number.isSafeInteger(size) || size <= 0) {
    throw new Error(`${target} blockmap HEAD did not return a valid object size`);
  }

  const rangeResponse = await fetchImpl(immutableBlockmapUrl, {
    headers: ONE_BYTE_RANGE_HEADERS,
    redirect: 'error',
    signal: AbortSignal.timeout(timeoutMs),
  });
  await rangeResponse.body?.cancel();
  if (
    rangeResponse.status !== 206 ||
    rangeResponse.headers.get('content-range') !== `bytes 0-0/${size}`
  ) {
    throw new Error(`${target} blockmap did not satisfy the one-byte range smoke test`);
  }
  return true;
}
