import crypto from 'node:crypto';

import { CcConnectProtocol, type CcConnectHealth } from './constants';

export function createCcConnectProtocolHeaders(requestId = crypto.randomUUID()): Record<string, string> {
  return {
    [CcConnectProtocol.Header.Version]: CcConnectProtocol.Version,
    [CcConnectProtocol.Header.RequestId]: requestId,
    [CcConnectProtocol.Header.Timestamp]: String(Date.now()),
    [CcConnectProtocol.Header.Nonce]: crypto.randomUUID(),
  };
}

export function isCcConnectHealth(value: unknown): value is CcConnectHealth {
  if (!value || typeof value !== 'object') return false;
  const health = value as Partial<CcConnectHealth>;
  return health.protocolVersion === CcConnectProtocol.Version &&
    Number.isInteger(health.pid) && Number.isInteger(health.parentPid) &&
    Array.isArray(health.capabilities) && health.capabilities.every(item => typeof item === 'string') &&
    Array.isArray(health.platforms) && health.platforms.every(item =>
      !!item && typeof item.accountId === 'string' && typeof item.platform === 'string' &&
      ['starting', 'ready', 'unavailable'].includes(item.state) &&
      (item.lastError === undefined || typeof item.lastError === 'string'));
}
