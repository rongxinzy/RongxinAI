import {
  CodingAgentCheckFailure,
  CodingErrorDetailMessage,
  CodingErrorMessage,
} from '../../../shared/codingAgent';
import { AcpProtocolIncompatibleError } from './protocol';

/** Only a category leaves the main process; stderr can contain model credentials. */
export function classifyProbeFailure(error: unknown): CodingAgentCheckFailure {
  if (error instanceof AcpProtocolIncompatibleError) return CodingAgentCheckFailure.Protocol;
  const message = error instanceof Error ? error.message : '';
  if (message === CodingErrorMessage.AgentProbeNoAnswer) return CodingAgentCheckFailure.NoReply;
  if (message === CodingErrorMessage.AgentAuthRequired)
    return CodingAgentCheckFailure.Authentication;
  if (
    message.includes(CodingErrorDetailMessage.AcpRequestTimedOut) ||
    /timed?\s*out|ETIMEDOUT/i.test(message)
  )
    return CodingAgentCheckFailure.Timeout;
  if (
    /ENOENT|EACCES|EPERM|spawn|(?:agent|process)(?: has)? exited|os error 5|access (?:is )?denied|拒绝访问/i.test(
      message,
    )
  )
    return CodingAgentCheckFailure.Startup;
  return CodingAgentCheckFailure.Connection;
}
