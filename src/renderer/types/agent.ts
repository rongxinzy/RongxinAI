type AgentSource = 'custom' | 'preset' | 'expert-package' | 'expert-package-member';

export interface Agent {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  identity: string;
  model: string;
  workingDirectory: string;
  icon: string;
  skillIds: string[];
  enabled: boolean;
  pinned: boolean;
  pinOrder?: number | null;
  isDefault: boolean;
  source: AgentSource;
  presetId: string;
  triageOverride?: import('../../shared/triage').AgentTriageOverride;
  createdAt: number;
  updatedAt: number;
}
