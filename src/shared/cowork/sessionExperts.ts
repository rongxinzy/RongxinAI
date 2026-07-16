export const CoworkSessionExpertSource = {
  Package: 'expert-package',
  Member: 'expert-package-member',
} as const;

export type CoworkSessionExpertSource = typeof CoworkSessionExpertSource[keyof typeof CoworkSessionExpertSource];

export interface CoworkSessionExpertSnapshot {
  expertId: string;
  packageId: string;
  expertName: string;
  source: CoworkSessionExpertSource;
  promptSnapshot: string;
  skillIds: string[];
  capabilityPolicy: Record<string, unknown>;
  contentHash: string;
  createdAt: number;
}

export interface CoworkSessionExpertInput {
  expertId: string;
  packageId: string;
  expertName: string;
  source: CoworkSessionExpertSnapshot['source'];
  promptSnapshot: string;
  skillIds: string[];
  capabilityPolicy?: Record<string, unknown>;
  contentHash: string;
}
