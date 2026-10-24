import { strataContract } from './strataContract';

export const strataContractChannels = Object.fromEntries(
  Object.entries(strataContract).map(([key, value]) => [key, value.channel]),
) as { [K in keyof typeof strataContract]: (typeof strataContract)[K]['channel'] };
