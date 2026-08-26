import {
  EnterpriseRendererMessageSource,
  EnterpriseRendererMessageType,
  EnterpriseRendererSessionOperation,
  type EnterpriseRendererModelCatalogRequestMessage,
  type EnterpriseRendererModelCatalogResult,
  type EnterpriseRendererReadyMessage,
  type EnterpriseRendererSessionRequestMessage,
} from '../../shared/enterpriseRenderer';
import type { EnterpriseSessionResult } from '../../shared/enterpriseSession';

const MAX_REQUEST_ID_LENGTH = 128;

export function isEnterpriseRendererReadyMessage(
  value: unknown,
): value is EnterpriseRendererReadyMessage {
  const message = asRecord(value);
  return (
    message?.source === EnterpriseRendererMessageSource.Module &&
    message.apiVersion === 1 &&
    message.type === EnterpriseRendererMessageType.Ready
  );
}

export function parseEnterpriseModelCatalogRequest(
  value: unknown,
): EnterpriseRendererModelCatalogRequestMessage | null {
  const message = asRecord(value);
  if (
    message?.source !== EnterpriseRendererMessageSource.Module ||
    message.apiVersion !== 1 ||
    message.type !== EnterpriseRendererMessageType.ModelCatalogRequest ||
    typeof message.requestId !== 'string' ||
    message.requestId.length === 0 ||
    message.requestId.length > MAX_REQUEST_ID_LENGTH
  ) {
    return null;
  }
  return message as unknown as EnterpriseRendererModelCatalogRequestMessage;
}

export function parseEnterpriseSessionRequest(
  value: unknown,
): EnterpriseRendererSessionRequestMessage | null {
  const message = asRecord(value);
  if (
    message?.source !== EnterpriseRendererMessageSource.Module ||
    message.apiVersion !== 1 ||
    message.type !== EnterpriseRendererMessageType.SessionRequest ||
    typeof message.requestId !== 'string' ||
    message.requestId.length === 0 ||
    message.requestId.length > MAX_REQUEST_ID_LENGTH
  ) {
    return null;
  }

  switch (message.operation) {
    case EnterpriseRendererSessionOperation.Snapshot:
    case EnterpriseRendererSessionOperation.Logout:
      return message as unknown as EnterpriseRendererSessionRequestMessage;
    case EnterpriseRendererSessionOperation.Login:
      return isLoginInput(message.input)
        ? (message as unknown as EnterpriseRendererSessionRequestMessage)
        : null;
    case EnterpriseRendererSessionOperation.ChangePassword:
      return isPasswordChangeInput(message.input)
        ? (message as unknown as EnterpriseRendererSessionRequestMessage)
        : null;
    default:
      return null;
  }
}

export function executeEnterpriseSessionRequest(
  request: EnterpriseRendererSessionRequestMessage,
): Promise<EnterpriseSessionResult> {
  switch (request.operation) {
    case EnterpriseRendererSessionOperation.Snapshot:
      return window.electron.enterprise.session.snapshot();
    case EnterpriseRendererSessionOperation.Login:
      return window.electron.enterprise.session.login(request.input);
    case EnterpriseRendererSessionOperation.ChangePassword:
      return window.electron.enterprise.session.changePassword(request.input);
    case EnterpriseRendererSessionOperation.Logout:
      return window.electron.enterprise.session.logout();
  }
}

export async function executeEnterpriseModelCatalogRequest(): Promise<EnterpriseRendererModelCatalogResult> {
  try {
    return { ok: true, models: await window.electron.managedProviders.catalog() };
  } catch {
    return { ok: false };
  }
}

function isLoginInput(value: unknown): boolean {
  const input = asRecord(value);
  return (
    typeof input?.enterpriseId === 'string' &&
    typeof input.username === 'string' &&
    typeof input.password === 'string'
  );
}

function isPasswordChangeInput(value: unknown): boolean {
  const input = asRecord(value);
  return typeof input?.currentPassword === 'string' && typeof input.newPassword === 'string';
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}
