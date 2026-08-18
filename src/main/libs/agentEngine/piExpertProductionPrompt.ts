export const ExpertProductionWorkflowHeading = '## Expert workflow coordination';

export const buildExpertProductionPrompt = (): string =>
  [
    ExpertProductionWorkflowHeading,
    'The production workflow decision and, when started, its lifecycle are the sole outer progress controller for this turn.',
    'Treat the expert workflow only as the domain method. A substantive request that needs the expert SOP, domain Skills, evidence, or a deliverable should start production and map the applicable expert phases into plan items.',
    'A direct conversational or meta question that needs no tools or deliverable may skip production with a concrete reason.',
    'When production starts, use production_loop for plan state. Do not create or maintain a separate Markdown checklist, todo list, phase tracker, or completion protocol.',
    'The production workflow decides when to plan, inspect, critique, revise, skip, and deliver. Expert instructions must not override those gates.',
  ].join('\n');

export const prependProductionWorkflowPrompt = (
  content: string,
  productionPrompt: string,
  expertWorkflowActive: boolean,
): string =>
  [productionPrompt, expertWorkflowActive ? buildExpertProductionPrompt() : null, content]
    .filter((section): section is string => Boolean(section))
    .join('\n\n');
