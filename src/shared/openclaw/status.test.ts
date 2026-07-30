import { expect, test } from 'vitest';

import { OpenClawEnginePhase } from './constants';
import { isOpenClawEngineTransitioning, isOpenClawGatewayRunning } from './status';

test('treats planned restart phases as transitions', () => {
  expect(isOpenClawEngineTransitioning(OpenClawEnginePhase.Starting)).toBe(true);
  expect(isOpenClawEngineTransitioning(OpenClawEnginePhase.Compiling)).toBe(true);
  expect(isOpenClawEngineTransitioning(OpenClawEnginePhase.Restarting)).toBe(true);
  expect(isOpenClawEngineTransitioning(OpenClawEnginePhase.Ready)).toBe(false);
});

test('only treats the running phase as gateway ready', () => {
  expect(isOpenClawGatewayRunning(OpenClawEnginePhase.Running)).toBe(true);
  expect(isOpenClawGatewayRunning(OpenClawEnginePhase.Restarting)).toBe(false);
});
