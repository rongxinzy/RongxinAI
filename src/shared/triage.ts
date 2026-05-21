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
} as const;

export type TriageIpcChannel = (typeof TriageIpcChannel)[keyof typeof TriageIpcChannel];
