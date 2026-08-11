import type { EngramObservation } from './types';

const CJK_PATTERN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const TOKEN_PATTERN = /[\p{L}\p{N}_]+/gu;
const MEMORY_INTENT_PATTERN =
  /(?:记得|记忆|之前|以前|上次|历史|曾经|当前.{0,6}(?:项目|偏好|决定)|(?:项目|偏好|决定).{0,4}(?:是什么|有哪些)|还记得|what did we|do you remember|previous(?:ly)?|last time|memory|memories)/iu;
const STOP_WORDS = new Set([
  '的',
  '了',
  '是',
  '在',
  '和',
  '与',
  '或',
  '吗',
  '呢',
  '吧',
  '我',
  '你',
  '我们',
  '这个',
  '那个',
  '什么',
  '一下',
  '当前',
  '请',
  '帮我',
  'about',
  'did',
  'do',
  'the',
  'what',
]);

interface SegmentData {
  segment: string;
  isWordLike?: boolean;
}

interface SegmenterLike {
  segment(input: string): Iterable<SegmentData>;
}

interface SegmenterConstructor {
  new (locales?: string | string[], options?: { granularity?: string }): SegmenterLike;
}

export interface RecallQueryPlan {
  exactQuery: string;
  broadQuery: string | null;
  explicitMemoryIntent: boolean;
}

export interface RecallRankingMetadata {
  importance: number;
  updatedAt: string;
}

export function planRecallQuery(query: string): RecallQueryPlan {
  const exactQuery = query.trim();
  const broadQuery = CJK_PATTERN.test(exactQuery) ? buildBroadQuery(exactQuery) : null;
  return {
    exactQuery,
    broadQuery:
      broadQuery && normalizeForComparison(broadQuery) !== normalizeForComparison(exactQuery)
        ? broadQuery
        : null,
    explicitMemoryIntent: MEMORY_INTENT_PATTERN.test(exactQuery),
  };
}

export function rankRecallResults(
  query: string,
  observations: EngramObservation[],
  metadata: ReadonlyMap<number, RecallRankingMetadata> = new Map(),
): EngramObservation[] {
  const normalizedQuery = query.toLocaleLowerCase();
  const terms = tokenizeForRanking(query);
  const now = Date.now();
  return [...observations].sort((left, right) => {
    const scoreDifference =
      scoreObservation(right, normalizedQuery, terms, metadata.get(right.id), now) -
      scoreObservation(left, normalizedQuery, terms, metadata.get(left.id), now);
    if (scoreDifference !== 0) return scoreDifference;
    return (right.updated_at ?? '').localeCompare(left.updated_at ?? '');
  });
}

function buildBroadQuery(query: string): string | null {
  const segmenterConstructor = (Intl as typeof Intl & { Segmenter?: SegmenterConstructor })
    .Segmenter;
  const rawSegments = segmenterConstructor
    ? [...new segmenterConstructor(['zh', 'ja', 'ko'], { granularity: 'word' }).segment(query)]
        .filter(item => item.isWordLike !== false)
        .map(item => item.segment)
    : (query.match(TOKEN_PATTERN) ?? []);
  const terms = rawSegments
    .flatMap((segment): string[] => [...(segment.match(TOKEN_PATTERN) ?? [])])
    .map(segment => segment.toLocaleLowerCase())
    .filter(segment => segment.length > 0 && !STOP_WORDS.has(segment));
  const uniqueTerms = [...new Set(terms)];
  return uniqueTerms.length > 0 ? uniqueTerms.join(' ') : null;
}

function tokenizeForRanking(query: string): string[] {
  const plan = CJK_PATTERN.test(query) ? buildBroadQuery(query) : query;
  return [...new Set((plan?.match(TOKEN_PATTERN) ?? []).map(term => term.toLocaleLowerCase()))];
}

function scoreObservation(
  observation: EngramObservation,
  normalizedQuery: string,
  terms: string[],
  metadata: RecallRankingMetadata | undefined,
  now: number,
): number {
  const title = observation.title.toLocaleLowerCase();
  const content = observation.content.toLocaleLowerCase();
  let score = 0;
  if (title === normalizedQuery) score += 24;
  else if (title.includes(normalizedQuery)) score += 12;
  if (content.includes(normalizedQuery)) score += 6;
  for (const term of terms) {
    if (title.includes(term)) score += 3;
    if (content.includes(term)) score += 1;
  }
  score += (metadata?.importance ?? 0.5) * 4;
  const updatedAt = Date.parse(metadata?.updatedAt ?? observation.updated_at);
  if (Number.isFinite(updatedAt)) {
    const ageDays = Math.max(0, (now - updatedAt) / 86_400_000);
    score += 2 / (1 + ageDays / 30);
  }
  if (typeof observation.rank === 'number') score += 1 / (1 + Math.abs(observation.rank));
  return score;
}

function normalizeForComparison(value: string): string {
  return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}_]+/gu, '');
}
