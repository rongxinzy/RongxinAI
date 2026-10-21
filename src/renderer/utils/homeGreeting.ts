export type HomeGreetingKey =
  | 'homeGreetingMorning'
  | 'homeGreetingAfternoon'
  | 'homeGreetingEvening';

/** Time-of-day greeting for the quiet studio home; one 24px line per screen. */
export function homeGreetingKey(now: Date = new Date()): HomeGreetingKey {
  const hour = now.getHours();
  if (hour < 12) return 'homeGreetingMorning';
  if (hour < 18) return 'homeGreetingAfternoon';
  return 'homeGreetingEvening';
}
