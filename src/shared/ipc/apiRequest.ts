export const ApiRequestPurpose = {
  ConnectivityTest: 'connectivity-test',
} as const;

export type ApiRequestPurpose = (typeof ApiRequestPurpose)[keyof typeof ApiRequestPurpose];

export function shouldRecordApiRequest(purpose?: ApiRequestPurpose): boolean {
  return purpose !== ApiRequestPurpose.ConnectivityTest;
}
