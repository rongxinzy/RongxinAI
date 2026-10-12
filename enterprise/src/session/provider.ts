import {
  type EnterprisePasswordChangeInput,
  type EnterprisePasswordLoginInput,
  type EnterpriseSessionSnapshot,
  EnterpriseSessionStatus,
  type ZhiyuanEnterpriseSessionProvider,
} from '../host-contract.js';
import { AepMetadataError, type ZhiyuanPasswordSession } from './password-session.js';

export class ZhiyuanPasswordSessionProvider implements ZhiyuanEnterpriseSessionProvider {
  readonly #session: ZhiyuanPasswordSession;

  constructor(session: ZhiyuanPasswordSession) {
    this.#session = session;
  }

  snapshot(): EnterpriseSessionSnapshot {
    return this.#session.snapshot();
  }

  login(input: EnterprisePasswordLoginInput): Promise<EnterpriseSessionSnapshot> {
    return this.#session
      .login({
        aepBaseUrl: input.aepBaseUrl,
        username: input.username,
        password: input.password,
      })
      .catch(error => {
        // The host v1 session result cannot carry extension error detail, so a
        // metadata failure is surfaced as a signed-out snapshot; the renderer
        // reads a non-authenticated login response as a metadata failure.
        if (error instanceof AepMetadataError) {
          return Object.freeze({ status: EnterpriseSessionStatus.SignedOut });
        }
        throw error;
      });
  }

  changePassword(input: EnterprisePasswordChangeInput): Promise<EnterpriseSessionSnapshot> {
    return this.#session.changePassword(input.currentPassword, input.newPassword);
  }

  logout(): Promise<EnterpriseSessionSnapshot> {
    return this.#session.logout();
  }
}
