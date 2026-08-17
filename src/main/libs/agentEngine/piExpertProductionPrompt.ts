export const ExpertProductionWorkflowHeading = '## Expert workflow coordination';

export const buildExpertProductionPrompt = (): string =>
  [
    ExpertProductionWorkflowHeading,
    'The production workflow is the sole outer lifecycle and progress controller for this turn.',
    'Treat the active expert workflow only as the domain method: select the applicable expert phases and map them into production plan items.',
    'Use production_loop for plan state. Do not create or maintain a separate Markdown checklist, todo list, phase tracker, or completion protocol.',
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
