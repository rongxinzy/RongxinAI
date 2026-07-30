import { CoreSkillId } from '../../../shared/skills/constants';

export const PiResearchStateToolName = 'research_state';
export const PiResearchStateAction = {
  Plan: 'plan',
  Direction: 'direction',
  VerifySource: 'verify_source',
  Claim: 'claim',
  Contradictions: 'contradictions',
} as const;
export type PiResearchStateAction =
  (typeof PiResearchStateAction)[keyof typeof PiResearchStateAction];

export const RESEARCH_MAX_ITERATIONS = 15;
export const MIN_RESEARCH_ITERATIONS = 3;
export const MIN_RESEARCH_SUBQUESTIONS = 3;
export const MIN_VERIFIED_SOURCES = 6;
export const MIN_PRIMARY_SOURCE_RATIO = 0.3;

export const ResearchRunStatus = {
  Running: 'running',
  CompletionRequested: 'completion_requested',
  Completed: 'completed',
  NeedsAttention: 'needs_attention',
} as const;
export type ResearchRunStatus = (typeof ResearchRunStatus)[keyof typeof ResearchRunStatus];

export const ResearchSourceType = {
  Primary: 'primary',
  Secondary: 'secondary',
} as const;
export type ResearchSourceType = (typeof ResearchSourceType)[keyof typeof ResearchSourceType];

export interface PiResearchRunOptions {
  sessionId: string;
  workspaceRoot: string;
  task: string;
}

export interface ResearchSource {
  url: string;
  sourceType: ResearchSourceType;
  verifiedAt: string;
}

export interface ResearchClaim {
  id: string;
  questionId: string;
  statement: string;
  sourceUrls: string[];
}

export interface ResearchQuestion {
  id: string;
  question: string;
}

export interface ResearchReview {
  requested: boolean;
  passed: boolean;
  output?: string;
}

export interface ResearchRunState {
  version: 1;
  sessionId: string;
  task: string;
  status: ResearchRunStatus;
  iteration: number;
  staleCount: number;
  lastFindingCount: number;
  researcherIterations: number[];
  subquestions: ResearchQuestion[];
  sources: ResearchSource[];
  claims: ResearchClaim[];
  directionsTried: string[];
  contradictionCheck?: string;
  review: ResearchReview;
  completionReason?: string;
  updatedAt: string;
}

export interface ResearchEndDecision {
  shouldFinish: boolean;
  reason?: string;
  nextPrompt?: string;
}

export interface ResearchToolResult {
  content: Array<{ type: 'text'; text: string }>;
  details: Record<string, unknown>;
}

export const isAcademicResearchSkillSet = (skillIds: string[] | undefined): boolean =>
  Boolean(skillIds?.includes(CoreSkillId.DeliAutoResearch));

export const isResearchSourceType = (value: unknown): value is ResearchSourceType =>
  value === ResearchSourceType.Primary || value === ResearchSourceType.Secondary;
