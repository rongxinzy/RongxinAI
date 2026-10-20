import { verifyPreflightResults } from './policy.ts';

const includePackaging = process.env.INCLUDE_PACKAGING;
if (includePackaging !== 'true' && includePackaging !== 'false') {
  throw new Error('INCLUDE_PACKAGING must explicitly be true or false');
}
verifyPreflightResults(
  JSON.parse(process.env.PREFLIGHT_RESULTS ?? ''),
  includePackaging === 'true',
);
console.log('[ReleasePreflight] all required checks passed');
