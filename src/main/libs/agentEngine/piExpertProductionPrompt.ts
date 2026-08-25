export const ExpertProductionWorkflowHeading = '## Expert workflow coordination';

export const buildExpertProductionPrompt = (): string =>
  [
    ExpertProductionWorkflowHeading,
    'When activated, the production workflow is the sole outer progress controller for this turn.',
    'Treat the expert workflow only as the domain method. For a substantive request that needs the expert SOP, domain Skills, evidence, or a deliverable, activate production and map the applicable expert phases into plan items.',
    'For direct conversation or a simple meta question, answer normally without calling production_loop.',
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
