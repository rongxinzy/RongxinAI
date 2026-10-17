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
  'which',
  'who',
  'when',
  'where',
  'how',
  'does',
  'this',
  'that',
  'for',
  'on',
  'to',
  'a',
  'an',
  'in',
  'is',
  'are',
  'was',
  'were',
  'have',
  'has',
  'had',
  'will',
  'would',
  'could',
  'should',
  'can',
  'any',
  'only',
  'using',
  'prior',
  'context',
  'call',
  'tools',
  'not',
  'with',
  'from',
  'into',
  'your',
  'our',
  'their',
  'already',
  'one',
  'short',
  'sentence',
  'answer',
  'team',
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
  allowRecentFallback: boolean;
}

export interface RecallRankingMetadata {
  importance: number;
  updatedAt: string;
}

export function planRecallQuery(query: string): RecallQueryPlan {
  const exactQuery = query.trim();
  if (!exactQuery) {
    return {
      exactQuery: '',
      broadQuery: null,
      explicitMemoryIntent: false,
      allowRecentFallback: false,
    };
  }
  const keywordQuery = buildKeywordQuery(exactQuery);
  const broadQuery =
    keywordQuery &&
    (normalizeForComparison(keywordQuery) !== normalizeForComparison(exactQuery) ||
      countWordLikeTokens(exactQuery) >= 5)
      ? keywordQuery
      : null;
  const explicitMemoryIntent = MEMORY_INTENT_PATTERN.test(exactQuery);
  return {
    exactQuery,
    broadQuery,
    explicitMemoryIntent,
    allowRecentFallback: shouldAllowRecentFallback(exactQuery, explicitMemoryIntent, keywordQuery),
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

export function buildKeywordQuery(query: string): string | null {
  const segmenterConstructor = (Intl as typeof Intl & { Segmenter?: SegmenterConstructor })
    .Segmenter;
  const rawSegments = CJK_PATTERN.test(query)
    ? segmenterConstructor
      ? [...new segmenterConstructor(['zh', 'ja', 'ko'], { granularity: 'word' }).segment(query)]
          .filter(item => item.isWordLike !== false)
          .map(item => item.segment)
      : (query.match(TOKEN_PATTERN) ?? [])
    : (query.match(TOKEN_PATTERN) ?? []);
  const terms = rawSegments
    .flatMap((segment): string[] => [...(segment.match(TOKEN_PATTERN) ?? [])])
    .map(segment => segment.toLocaleLowerCase())
    .filter(segment => segment.length > 1 && !STOP_WORDS.has(segment));
  const uniqueTerms = [...new Set(terms)];
  return uniqueTerms.length > 0 ? uniqueTerms.join(' ') : null;
}

function shouldAllowRecentFallback(
  query: string,
  explicitMemoryIntent: boolean,
  keywordQuery: string | null,
): boolean {
  if (explicitMemoryIntent) return true;
  if (/[?？]/.test(query)) return true;
  const keywordCount = keywordQuery ? keywordQuery.split(/\s+/).filter(Boolean).length : 0;
  return keywordCount >= 2 && countWordLikeTokens(query) >= 6;
}

function countWordLikeTokens(query: string): number {
  return (query.match(TOKEN_PATTERN) ?? []).length;
}

function tokenizeForRanking(query: string): string[] {
  const keywordQuery = buildKeywordQuery(query);
  const source = keywordQuery ?? query;
  return [...new Set((source.match(TOKEN_PATTERN) ?? []).map(term => term.toLocaleLowerCase()))];
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
