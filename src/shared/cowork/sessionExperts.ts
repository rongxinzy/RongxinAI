export const CoworkSessionExpertSource = {
  Package: 'expert-package',
  Member: 'expert-package-member',
} as const;

export type CoworkSessionExpertSource =
  (typeof CoworkSessionExpertSource)[keyof typeof CoworkSessionExpertSource];

export const COWORK_SESSION_MAX_EXPERTS = 1;

/** Normalizes the expert selection and enforces the single-expert session invariant. */
export const normalizeSingleExpertIds = (expertIds: readonly string[] | undefined): string[] => {
  const normalizedIds = [
    ...new Set((expertIds ?? []).map(expertId => expertId.trim()).filter(Boolean)),
  ];
  if (normalizedIds.length > COWORK_SESSION_MAX_EXPERTS) {
    throw new Error('Only one expert can be used for a session turn');
  }
  return normalizedIds;
};

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

/** Expert identity frozen onto a conversation turn for display after the session changes. */
export interface CoworkMessageExpertIdentity {
  expertId: string;
  expertName: string;
  presetId: string;
}
