import { isIP } from 'node:net';

import { PiResearchRunStore } from './piResearchStore';
import {
  type ResearchClaim,
  type ResearchRunState,
  type ResearchSourceType,
} from './piResearchTypes';

const now = (): string => new Date().toISOString();

const isBlockedIpv4 = (address: string): boolean => {
  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some(octet => !Number.isInteger(octet))) return true;
  const [first, second] = octets;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    first >= 224
  );
};

const isBlockedHostname = (hostname: string): boolean => {
  const normalized = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (normalized === 'localhost' || normalized.endsWith('.localhost')) return true;
  const ipVersion = isIP(normalized);
  if (ipVersion === 4) return isBlockedIpv4(normalized);
  if (ipVersion === 6) {
    return (
      normalized === '::' ||
      normalized === '::1' ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      normalized.startsWith('fe8') ||
      normalized.startsWith('fe9') ||
      normalized.startsWith('fea') ||
      normalized.startsWith('feb') ||
      normalized.startsWith('::ffff:')
    );
  }
  return false;
};

export async function verifyResearchSource(
  state: ResearchRunState,
  store: PiResearchRunStore,
  url: string,
  sourceType: ResearchSourceType,
): Promise<string> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'Source was not recorded: URL is invalid.';
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return 'Source was not recorded: only http(s) URLs can be verified.';
  }
  if (parsed.username || parsed.password || isBlockedHostname(parsed.hostname)) {
    return 'Source was not recorded: local, private, or credential-bearing URLs are not allowed.';
  }
  try {
    let current = parsed;
    let verified = false;
    const signal = AbortSignal.timeout(15_000);
    for (let redirectCount = 0; redirectCount <= 5; redirectCount += 1) {
      const response = await fetch(current, { signal, redirect: 'manual' });
      const location = response.headers?.get?.('location');
      if (response.status >= 300 && response.status < 400 && location) {
        await response.body?.cancel();
        current = new URL(location, current);
        if (
          !['http:', 'https:'].includes(current.protocol) ||
          current.username ||
          current.password ||
          isBlockedHostname(current.hostname)
        ) {
          return 'Source was not recorded: redirect target is local, private, or unsafe.';
        }
        continue;
      }
      await response.body?.cancel();
      if (!response.ok) {
        return `Source was not recorded: URL returned HTTP ${response.status}.`;
      }
      verified = true;
      break;
    }
    if (!verified) return 'Source was not recorded: URL exceeded the redirect limit.';
    if (current.toString() !== parsed.toString()) {
      store.log(
        'orchestrator',
        'info',
        'source_redirected',
        `Verified redirect chain from ${parsed.toString()} to ${current.toString()}.`,
      );
    }
  } catch (error) {
    return `Source was not recorded: fetch failed (${error instanceof Error ? error.message : String(error)}).`;
  }
  const normalized = parsed.toString();
  const existing = state.sources.find(source => source.url === normalized);
  if (!existing) {
    const verifiedAt = now();
    state.sources.push({ url: normalized, sourceType, verifiedAt });
    store.appendFinding({
      type: 'verified_source',
      url: normalized,
      sourceType,
      verifiedAt,
    });
    store.writeState(state);
  }
  return `Verified and recorded source: ${normalized}`;
}

export function setResearchPlan(
  state: ResearchRunState,
  store: PiResearchRunStore,
  subquestions: string[],
): string {
  const unique = [...new Set(subquestions.map(question => question.trim()).filter(Boolean))];
  if (unique.length === 0) {
    return 'Plan was not recorded: provide at least one non-empty subquestion.';
  }
  const planChanged =
    state.subquestions.map(question => question.question).join('\n') !== unique.join('\n');
  if (planChanged && state.subquestions.length > 0) {
    state.claims = [];
    delete state.contradictionCheck;
    store.log(
      'orchestrator',
      'decision',
      'plan_changed',
      'Existing claims and contradiction check were cleared because their question mapping is no longer valid.',
    );
  }
  state.subquestions = unique.map((question, index) => ({
    id: `q${index + 1}`,
    question,
  }));
  store.writeState(state);
  store.log('orchestrator', 'decision', 'plan_recorded', `${unique.length} subquestions recorded.`);
  return `Recorded ${unique.length} subquestions.`;
}

export function addResearchDirection(
  state: ResearchRunState,
  store: PiResearchRunStore,
  direction: string,
): string {
  const normalized = direction.trim();
  if (!normalized) return 'Direction was not recorded: it is empty.';
  if (state.directionsTried.includes(normalized)) {
    return 'Direction was not recorded: it duplicates a previously tried direction.';
  }
  state.directionsTried.push(normalized);
  store.writeDirections(state.directionsTried);
  store.writeState(state);
  store.log('orchestrator', 'decision', 'direction_recorded', normalized);
  return 'Recorded a new research direction.';
}

export function addResearchClaim(
  state: ResearchRunState,
  store: PiResearchRunStore,
  id: string,
  questionId: string,
  statement: string,
  sourceUrls: string[],
): string {
  const normalizedId = id.trim();
  const normalizedStatement = statement.trim();
  if (!normalizedId) return 'Claim was not recorded: claimId is empty.';
  if (!normalizedStatement) return 'Claim was not recorded: statement is empty.';
  if (!state.subquestions.some(question => question.id === questionId)) {
    return `Claim was not recorded: unknown question id "${questionId}".`;
  }
  const verified = new Set(state.sources.map(source => source.url));
  const uniqueUrls = [...new Set(sourceUrls)];
  if (uniqueUrls.length < 2 || uniqueUrls.some(url => !verified.has(url))) {
    return 'Claim was not recorded: each load-bearing claim needs two verified source URLs.';
  }
  const claim: ResearchClaim = {
    id: normalizedId,
    questionId,
    statement: normalizedStatement,
    sourceUrls: uniqueUrls,
  };
  const index = state.claims.findIndex(existing => existing.id === normalizedId);
  if (index >= 0) state.claims[index] = claim;
  else state.claims.push(claim);
  store.appendFinding({ type: 'claim', ...claim });
  store.writeState(state);
  return `Recorded claim "${normalizedId}" with ${uniqueUrls.length} verified sources.`;
}

export function setResearchContradictionCheck(
  state: ResearchRunState,
  store: PiResearchRunStore,
  summary: string,
): string {
  if (!summary.trim()) return 'Contradiction check was not recorded: summary is empty.';
  state.contradictionCheck = summary.trim();
  store.writeState(state);
  store.log('orchestrator', 'decision', 'contradiction_check_recorded', summary.trim());
  return 'Recorded contradiction check.';
}
