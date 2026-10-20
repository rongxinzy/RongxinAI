export const HomeGreetingLead = {
  Morning: 'coworkHomeGreetingLeadMorning',
  Afternoon: 'coworkHomeGreetingLeadAfternoon',
  Evening: 'coworkHomeGreetingLeadEvening',
  Night: 'coworkHomeGreetingLeadNight',
} as const;

export type HomeGreetingLead = (typeof HomeGreetingLead)[keyof typeof HomeGreetingLead];

/**
 * Time-of-day lead for the home greeting. The question lives in a second
 * nowrap line so neither language breaks mid-phrase.
 */
export function resolveHomeGreetingLead(date = new Date()): HomeGreetingLead {
  const hour = date.getHours();
  if (hour < 6) return HomeGreetingLead.Night;
  if (hour < 12) return HomeGreetingLead.Morning;
  if (hour < 18) return HomeGreetingLead.Afternoon;
  return HomeGreetingLead.Evening;
}
