import { request as httpRequest } from 'node:http';
import { request as httpsRequest, type RequestOptions } from 'node:https';
import { Readable } from 'node:stream';

interface PlatformRequest {
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

/** Scoped to discovered AISphere traffic, never changes Electron/global TLS settings. */
export const platformFetch: PlatformFetch = async (address, options = {}) => {
  const url = new URL(address);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Unsupported platform protocol.');
  }
  const send = (verify: boolean): Promise<Response> =>
    new Promise((resolve, reject) => {
      const request = url.protocol === 'https:' ? httpsRequest : httpRequest;
      const requestOptions: RequestOptions = {
        method: options.method ?? 'GET',
        headers: options.headers,
        signal: options.signal,
        rejectUnauthorized: verify,
      };
      const req = request(url, requestOptions, incoming => {
        const status = incoming.statusCode ?? 502;
        // Do not follow redirects, especially with platform-issued credentials.
        if (status >= 300 && status < 400) {
          incoming.destroy();
          reject(new Error('Platform redirects are not allowed.'));
          return;
        }
        const headers = new Headers();
        for (const [key, value] of Object.entries(incoming.headers)) {
          if (value !== undefined) {
            headers.set(key, Array.isArray(value) ? value.join(', ') : value);
          }
        }
        resolve(
          new Response(
            status === 204 || status === 304
              ? null
              : (Readable.toWeb(incoming) as ReadableStream<Uint8Array>),
            { status, headers },
          ),
        );
      });
      req.on('error', reject);
      req.end(options.body);
    });
  try {
    return await send(true);
  } catch (error) {
    if (
      url.protocol !== 'https:' ||
      !error ||
      typeof error !== 'object' ||
      !('code' in error) ||
      !CERTIFICATE_ERRORS.has(String(error.code))
    ) {
      throw error;
    }
    return send(false);
  }
};
