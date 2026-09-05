import { verifyGateResults } from './policy.ts';

// Invalid or missing JSON fails closed, including an unsuccessful planner.
verifyGateResults(
  JSON.parse(process.env.GATE_PLAN ?? ''),
  JSON.parse(process.env.GATE_RESULTS ?? ''),
);
console.log('[CiGate] all required checks passed');
