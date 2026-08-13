import type { ScheduledTaskChannelOption } from '../../../scheduledTask/types';

export function channelOptionValue(
  option: Pick<ScheduledTaskChannelOption, 'value' | 'accountId'>,
): string {
  return JSON.stringify([option.value, option.accountId ?? null]);
}

export function findChannelOption(
  options: readonly ScheduledTaskChannelOption[],
  value: string | null,
): ScheduledTaskChannelOption | undefined {
  return options.find(option => channelOptionValue(option) === value);
}
