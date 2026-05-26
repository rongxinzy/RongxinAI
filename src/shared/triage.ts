export const TRIAGE_TIERS = ['light', 'standard', 'heavy'] as const;
export type TriageTier = (typeof TRIAGE_TIERS)[number];

export const TRIAGE_TIER_ORDER: Record<TriageTier, number> = {
  light: 0,
  standard: 1,
  heavy: 2,
};

export interface TriageConfig {
  enabled: boolean;
  rules: {
    lightModelRef: string;
    heavyModelRef: string;
    maxConversationRoundsForTriage: number;
    allowCrossProviderSwitch: boolean;
    cooldownRounds: number;
    useLocalModelTriage: boolean;
    triageModelName: string;
  };
}

export const DEFAULT_TRIAGE_CONFIG: TriageConfig = {
  enabled: false,
  rules: {
    lightModelRef: '',
    heavyModelRef: '',
    maxConversationRoundsForTriage: 20,
    allowCrossProviderSwitch: false,
    cooldownRounds: 3,
    useLocalModelTriage: false,
    triageModelName: '',
  },
};

export interface TriageResult {
  tier: TriageTier;
  modelRef: string | null;
  reason: string;
}

export interface TriageState {
  lastSwitchRound: number;
  activeTier: TriageTier;
}

export const TriageIpcChannel = {
  GetConfig: 'triage:config:get',
  SetConfig: 'triage:config:set',
  GetAgentConfig: 'triage:agent-config:get',
  SetAgentConfig: 'triage:agent-config:set',
} as const;

export type TriageIpcChannel = (typeof TriageIpcChannel)[keyof typeof TriageIpcChannel];

/** Agent-level triage override. Fields left undefined inherit from global defaults. */
export interface AgentTriageOverride {
  enabled?: boolean;
  lightModelRef?: string;
  heavyModelRef?: string;
  allowCrossProviderSwitch?: boolean;
}

export const EMPTY_AGENT_TRIAGE_OVERRIDE: AgentTriageOverride = {
  enabled: undefined,
  lightModelRef: undefined,
  heavyModelRef: undefined,
  allowCrossProviderSwitch: undefined,
};
