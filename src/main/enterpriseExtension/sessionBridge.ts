import {
  type EnterprisePasswordChangeInput,
  type EnterprisePasswordLoginInput,
  type EnterpriseSessionIdentity,
  type EnterpriseSessionResult,
  type EnterpriseSessionSnapshot,
} from '../../shared/enterpriseSession';
import {
  ZHIYUAN_ENTERPRISE_SESSION_CAPABILITY_API_VERSION,
  type ZhiyuanEnterpriseSessionHostCapability,
  type ZhiyuanEnterpriseSessionProvider,
} from './contract';

const MAX_ENTERPRISE_ID_LENGTH = 256;
const MAX_USERNAME_LENGTH = 320;
const MAX_PASSWORD_LENGTH = 4096;

type ErrorLogger = (message: string, error: unknown) => void;

export class ZhiyuanEnterpriseSessionBridge implements ZhiyuanEnterpriseSessionHostCapability {
  readonly apiVersion = ZHIYUAN_ENTERPRISE_SESSION_CAPABILITY_API_VERSION;
  readonly #logError: ErrorLogger;
  #provider: ZhiyuanEnterpriseSessionProvider | null = null;

  constructor(
    logError: ErrorLogger = (message, error) => {
      console.error(message, error);
    },
  ) {
    this.#logError = logError;
  }

  registerProvider(provider: ZhiyuanEnterpriseSessionProvider): () => void {
    validateProvider(provider);
    if (this.#provider) {
      throw new Error('A Zhiyuan enterprise session provider is already registered.');
    }
    this.#provider = provider;
    let registered = true;
    return () => {
      if (!registered) return;
      registered = false;
      if (this.#provider === provider) this.#provider = null;
    };
  }

  snapshot(): Promise<EnterpriseSessionResult> {
    return this.#execute(provider => provider.snapshot());
  }

  login(input: unknown): Promise<EnterpriseSessionResult> {
    const parsed = parseLoginInput(input);
    if (!parsed) return Promise.resolve(invalidInput());
    return this.#execute(provider => provider.login(parsed));
  }

  changePassword(input: unknown): Promise<EnterpriseSessionResult> {
    const parsed = parsePasswordChangeInput(input);
    if (!parsed) return Promise.resolve(invalidInput());
    return this.#execute(provider => provider.changePassword(parsed));
  }

  logout(): Promise<EnterpriseSessionResult> {
    return this.#execute(provider => provider.logout());
  }

  async #execute(
    operation: (
      provider: ZhiyuanEnterpriseSessionProvider,
    ) => EnterpriseSessionSnapshot | Promise<EnterpriseSessionSnapshot>,
  ): Promise<EnterpriseSessionResult> {
    const provider = this.#provider;
    if (!provider) {
      return failure('UNAVAILABLE', 'Zhiyuan enterprise session is unavailable.');
    }
    try {
      return Object.freeze({
        ok: true,
        snapshot: normalizeSnapshot(await operation(provider)),
      });
    } catch (error) {
      this.#logError('[EnterpriseSession] Session operation failed:', error);
      return failure('OPERATION_FAILED', 'Zhiyuan enterprise session operation failed.');
    }
  }
}

export const zhiyuanEnterpriseSessionBridge = new ZhiyuanEnterpriseSessionBridge();

function parseLoginInput(value: unknown): EnterprisePasswordLoginInput | null {
  const input = asRecord(value);
  const enterpriseId = normalizedIdentifier(input?.enterpriseId, MAX_ENTERPRISE_ID_LENGTH);
  const username = normalizedIdentifier(input?.username, MAX_USERNAME_LENGTH);
  const password = boundedString(input?.password, MAX_PASSWORD_LENGTH);
  return enterpriseId && username && password ? { enterpriseId, username, password } : null;
}

function parsePasswordChangeInput(value: unknown): EnterprisePasswordChangeInput | null {
  const input = asRecord(value);
  const currentPassword = boundedString(input?.currentPassword, MAX_PASSWORD_LENGTH);
  const newPassword = boundedString(input?.newPassword, MAX_PASSWORD_LENGTH);
  return currentPassword && newPassword ? { currentPassword, newPassword } : null;
}

function boundedString(value: unknown, maxLength: number): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength ? value : null;
}

function normalizedIdentifier(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= maxLength ? normalized : null;
}

function normalizeSnapshot(value: unknown): EnterpriseSessionSnapshot {
  const snapshot = asRecord(value);
  if (
    snapshot?.status === 'unavailable' ||
    snapshot?.status === 'signed-out' ||
    snapshot?.status === 'recoverable'
  ) {
    return Object.freeze({ status: snapshot.status });
  }
  if (snapshot?.status !== 'authenticated') {
    throw new Error('Zhiyuan enterprise session provider returned an invalid snapshot.');
  }
  return Object.freeze({
    status: 'authenticated',
    identity: normalizeIdentity(snapshot.identity),
  });
}

function normalizeIdentity(value: unknown): EnterpriseSessionIdentity {
  const identity = asRecord(value);
  const user = asRecord(identity?.user);
  const enterprise = asRecord(identity?.enterprise);
  const roles = identity?.roles;
  if (
    !normalizedIdentifier(user?.id, 256) ||
    !normalizedIdentifier(user?.displayName, 512) ||
    !normalizedIdentifier(enterprise?.id, 256) ||
    !normalizedIdentifier(enterprise?.name, 512) ||
    !Array.isArray(roles) ||
    !roles.every(role => normalizedIdentifier(role, 128)) ||
    !boundedString(identity?.sessionExpiresAt, 128) ||
    typeof identity?.passwordChangeRequired !== 'boolean' ||
    !isOptionalEmail(user?.email)
  ) {
    throw new Error('Zhiyuan enterprise session provider returned an invalid identity.');
  }
  return Object.freeze({
    user: Object.freeze({
      id: user.id as string,
      displayName: user.displayName as string,
      ...(user.email === undefined ? {} : { email: user.email as string | null }),
    }),
    enterprise: Object.freeze({
      id: enterprise.id as string,
      name: enterprise.name as string,
    }),
    roles: Object.freeze([...roles]) as readonly string[],
    sessionExpiresAt: identity.sessionExpiresAt as string,
    passwordChangeRequired: identity.passwordChangeRequired,
  });
}

function validateProvider(provider: ZhiyuanEnterpriseSessionProvider): void {
  const candidate = asRecord(provider);
  if (
    typeof candidate?.snapshot !== 'function' ||
    typeof candidate.login !== 'function' ||
    typeof candidate.changePassword !== 'function' ||
    typeof candidate.logout !== 'function'
  ) {
    throw new Error('Zhiyuan enterprise session provider is incomplete.');
  }
}

function invalidInput(): EnterpriseSessionResult {
  return failure('INVALID_INPUT', 'Zhiyuan enterprise session input is invalid.');
}

function failure(
  code: 'UNAVAILABLE' | 'INVALID_INPUT' | 'OPERATION_FAILED',
  message: string,
): EnterpriseSessionResult {
  return Object.freeze({ ok: false, error: Object.freeze({ code, message }) });
}

function isOptionalEmail(value: unknown): boolean {
  return value === undefined || value === null || boundedString(value, 512) !== null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}
