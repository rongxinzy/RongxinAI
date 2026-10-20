import { verifyGateResults } from './policy.ts';

// Missing, failed, cancelled, or skipped unit/lint jobs cannot produce a green gate.
verifyGateResults(JSON.parse(process.env.GATE_RESULTS ?? ''));
console.log('[CiGate] all required checks passed');
