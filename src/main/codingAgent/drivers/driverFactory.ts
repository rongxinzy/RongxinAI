import type { CodingAgentProfile } from '../../../shared/codingAgent';
import { CodingAgentDriverKind } from '../../../shared/codingAgent';
import { AcpCodingDriver } from './acpCodingDriver';
import { BuiltinCodingDriver } from './builtinCodingDriver';
import type { CodingAgentDriver } from './codingAgentDriver';

export class CodingDriverFactory {
  constructor(
    private readonly builtin: ConstructorParameters<typeof BuiltinCodingDriver>[0],
    private readonly environment: Record<string, string | undefined>,
  ) {}

  create(profile: CodingAgentProfile): CodingAgentDriver {
    if (profile.driverKind === CodingAgentDriverKind.Builtin)
      return new BuiltinCodingDriver(this.builtin);
    if (!profile.command) throw new Error('ACP agent has no configured executable.');
    return new AcpCodingDriver({
      executable: profile.command,
      args: profile.args,
      environment: { ...this.environment, ...profile.environment },
    });
  }
}
