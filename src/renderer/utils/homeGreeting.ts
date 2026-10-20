export type HomeGreetingKey =
  | 'coworkHomeGreetingMorning'
  | 'coworkHomeGreetingAfternoon'
  | 'coworkHomeGreetingEvening'
  | 'coworkHomeGreetingNight';

/** Returns the i18n key for a time-of-day home greeting (local time). */
export function resolveHomeGreetingKey(date = new Date()): HomeGreetingKey {
  const hour = date.getHours();
  if (hour >= 5 && hour < 12) return 'coworkHomeGreetingMorning';
  if (hour >= 12 && hour < 18) return 'coworkHomeGreetingAfternoon';
  if (hour >= 18 && hour < 23) return 'coworkHomeGreetingEvening';
  return 'coworkHomeGreetingNight';
}
