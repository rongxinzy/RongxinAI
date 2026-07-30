import { OpenClawEnginePhase, type OpenClawEnginePhase as OpenClawEnginePhaseValue } from './constants';

export function isOpenClawGatewayRunning(
  phase: OpenClawEnginePhaseValue | null | undefined,
): boolean {
  return phase === OpenClawEnginePhase.Running;
}

export function isOpenClawEngineTransitioning(
  phase: OpenClawEnginePhaseValue | null | undefined,
): boolean {
  return (
    phase === OpenClawEnginePhase.Starting ||
    phase === OpenClawEnginePhase.Compiling ||
    phase === OpenClawEnginePhase.Restarting
  );
}
