import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest, type RequestOptions } from 'node:https';
import { Readable } from 'node:stream';


export interface PlatformRequest {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
  redirect?: 'error';
}
export type PlatformFetch = (url: string, options?: PlatformRequest) => Promise<Response>;

const CERTIFICATE_ERRORS = new Set([
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_DECRYPT_CERT_SIGNATURE',
  'CERT_REVOKED',
  'CERT_UNTRUSTED',
  'CERT_REJECTED',
  'INVALID_CA',
  'INVALID_PURPOSE',
  'PATH_LENGTH_EXCEEDED',
  'CERT_CHAIN_TOO_LONG',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'CERT_HAS_EXPIRED',
  'CERT_NOT_YET_VALID',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'CERT_SIGNATURE_FAILURE',
]);

const MAX_REDIRECTS = 5;

function isCertificateError(error: unknown): boolean {
  return (
    !!error &&
    typeof error === 'object' &&
    'code' in error &&
    CERTIFICATE_ERRORS.has(String(error.code))
  );
}

function isHttpToHttpsUpgrade(from: URL, to: URL): boolean {
  return from.protocol === 'http:' && to.protocol === 'https:' && from.hostname === to.hostname;
}

function requestOnce(
  url: URL,
  options: PlatformRequest,
  headers: Record<string, string> | undefined,
  verify: boolean,
): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const request = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const requestOptions: RequestOptions = {
      method: options.method ?? 'GET',
      headers,
      signal: options.signal,
      rejectUnauthorized: verify,
    };
    const req = request(url, requestOptions, resolve);
    req.on('error', reject);
    req.end(options.body);
  });
}

function toWebResponse(incoming: IncomingMessage, method: string | undefined): Response {
  const status = incoming.statusCode ?? 502;
  const responseHeaders = new Headers();
  for (const [key, value] of Object.entries(incoming.headers)) {
    // 2026/09/15 lixiang  Object.entries 将 header 值收窄为 unknown，显式转成 string
    if (typeof value === 'string') {
      responseHeaders.set(key, value);
    } else if (Array.isArray(value)) {
      responseHeaders.set(key, value.join(', '));
    }
  }
  const bodyless = method === 'HEAD' || status === 204 || status === 205;
  const response = new Response(
    bodyless ? null : (Readable.toWeb(incoming) as ReadableStream<Uint8Array>),
    { status, headers: responseHeaders },
  );
  if (bodyless) incoming.resume();
  return response;
}

/** Scoped to discovered AISphere traffic, never changes Electron/global TLS settings. */
export const platformFetch: PlatformFetch = async (address, options = {}) => {
  const initial = new URL(address);
  if (!['http:', 'https:'].includes(initial.protocol)) {
    throw new Error('Unsupported platform protocol.');
  }

  const send = async (
    url: URL,
    headers: Record<string, string> | undefined,
    redirects: number,
  ): Promise<Response> => {
    let incoming: IncomingMessage;
    try {
      incoming = await requestOnce(url, options, headers, true);
    } catch (error) {
      if (url.protocol !== 'https:' || !isCertificateError(error)) throw error;
      incoming = await requestOnce(url, options, headers, false);
    }

    const status = incoming.statusCode ?? 502;
    // Follow redirects manually so https downgrades are rejected while
    // same-or-upgraded schemes (e.g. http -> https behind nginx) proceed.
    if (status < 300 || status >= 400) {
      try {
        return toWebResponse(incoming, options.method);
      } catch (error) {
        incoming.destroy();
        throw error;
      }
    }

    const location = incoming.headers.location;
    incoming.destroy();
    if (options.redirect === 'error') {
      throw new Error('Platform redirect is not allowed.');
    }
    if (!location || typeof location !== 'string') {
      throw new Error('Platform redirect is missing a location.');
    }
    if (redirects >= MAX_REDIRECTS) {
      throw new Error('Platform redirect limit exceeded.');
    }

    let next: URL;
    try {
      next = new URL(location, url);
    } catch {
      throw new Error('Platform redirect location is invalid.');
    }
    if (!['http:', 'https:'].includes(next.protocol)) {
      throw new Error('Platform redirect location is invalid.');
    }
    if (next.protocol === 'http:' && url.protocol === 'https:') {
      throw new Error('Platform redirects may not downgrade to http.');
    }
    if (next.username || next.password) {
      throw new Error('Platform redirect credentials are not allowed.');
    }

    const nextHeaders = { ...headers };
    const schemeUpgrade = isHttpToHttpsUpgrade(url, next);
    if (next.origin !== url.origin && !schemeUpgrade) {
      if (nextHeaders.Authorization) {
        throw new Error('Platform redirects may not carry credentials.');
      }
      delete nextHeaders.Authorization;
    }
    // Same-origin redirects still must not bounce credentialed requests to a
    // different path unless this is an http→https host upgrade.
    if (
      nextHeaders.Authorization &&
      !schemeUpgrade &&
      (next.pathname !== url.pathname || next.search !== url.search)
    ) {
      throw new Error('Platform redirects may not carry credentials.');
    }

    return send(next, nextHeaders, redirects + 1);
  };

  return send(initial, options.headers, 0);
};
