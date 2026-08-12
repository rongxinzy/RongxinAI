import crypto from 'node:crypto';
import type http from 'node:http';

import { CcConnectProtocol } from '../../shared/ccConnect/constants';

export class CcConnectRequestAuthenticator {
  private readonly nonces = new Map<string, number>();

  constructor(private readonly token: string, private readonly now: () => number = Date.now) {}

  authorize(request: http.IncomingMessage): boolean {
    const authorization = request.headers.authorization;
    const expected = Buffer.from(`Bearer ${this.token}`);
    const actual = Buffer.from(typeof authorization === 'string' ? authorization : '');
    if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return false;
    if (request.headers[CcConnectProtocol.Header.Version] !== CcConnectProtocol.Version) return false;
    const timestamp = Number(request.headers[CcConnectProtocol.Header.Timestamp]);
    const nonce = request.headers[CcConnectProtocol.Header.Nonce];
    const now = this.now();
    if (!Number.isFinite(timestamp) || Math.abs(now - timestamp) > CcConnectProtocol.ClockSkewMs) return false;
    if (typeof nonce !== 'string' || !nonce.trim()) return false;
    for (const [known, expiresAt] of this.nonces) if (expiresAt <= now) this.nonces.delete(known);
    if (this.nonces.has(nonce)) return false;
    this.nonces.set(nonce, now + CcConnectProtocol.ClockSkewMs);
    return true;
  }
}
