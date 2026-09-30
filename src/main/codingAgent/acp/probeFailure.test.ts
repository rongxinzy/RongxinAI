import { expect, test } from 'vitest';
import {
  CodingAgentCheckFailure,
  CodingErrorDetailMessage,
  CodingErrorMessage,
} from '../../../shared/codingAgent';
import { classifyProbeFailure } from './probeFailure';
import { AcpProtocolIncompatibleError } from './protocol';

test.each([
  [new AcpProtocolIncompatibleError(99), CodingAgentCheckFailure.Protocol],
  [new Error(CodingErrorMessage.AgentAuthRequired), CodingAgentCheckFailure.Authentication],
  [new Error(CodingErrorMessage.AgentProbeNoAnswer), CodingAgentCheckFailure.NoReply],
  [
    new Error(CodingErrorDetailMessage.AcpRequestTimedOut + ' initialize'),
    CodingAgentCheckFailure.Timeout,
  ],
  [new Error('spawn executable ENOENT'), CodingAgentCheckFailure.Startup],
  [
    new Error(
      'ACP request initialize failed (code 1001): Codex process has exited with code 1: 拒绝访问。 (os error 5)',
    ),
    CodingAgentCheckFailure.Startup,
  ],
  [new Error('upstream unavailable'), CodingAgentCheckFailure.Connection],
])('classifies failures without returning raw diagnostics', (error, expected) => {
  expect(classifyProbeFailure(error)).toBe(expected);
});
