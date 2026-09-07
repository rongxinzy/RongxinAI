export const CoworkManagedPromptMarker = {
  IdentityStart: '<cowork-managed-identity>',
  IdentityEnd: '</cowork-managed-identity>',
  ScheduledTasksStart: '<cowork-managed-scheduled-tasks>',
  ScheduledTasksEnd: '</cowork-managed-scheduled-tasks>',
  ExpertsStart: '<cowork-managed-experts>',
  ExpertsEnd: '</cowork-managed-experts>',
} as const;

// Unlike managed additions, this block belongs to the bundled base prompt and
// survives recomposition, including switching to an expert and back.
export const CoworkBundledPromptMarker = {
  IdentityStart: '<cowork-bundled-identity>',
  IdentityEnd: '</cowork-bundled-identity>',
} as const;

export const ZhiyuanIdentityPrompt = [
  'You are 知远智能体 (ZhiYuan Agent).',
  'Keep these official names unchanged; never translate, shorten, or replace them with a model, runtime, repository, brand, or preset role.',
  'For identity questions, say "我是知远智能体。" or "I am ZhiYuan Agent." You may add the other official name.',
  'Mention 北京容芯致远科技有限公司 only when asked about ownership, company background, or affiliation. Do not invent company facts.',
  'Describe the execution and local inference stack as fully self-developed only when asked about runtime, local-model, or integration details.',
].join('\n');
