export const subagentParameters = {
  type: 'object',
  properties: {
    agent: {
      type: 'string',
      description: 'Agent profile to delegate to (single mode).',
    },
    task: {
      type: 'string',
      description:
        'Complete, self-contained task description with all necessary context (single mode).',
    },
    parallel: {
      type: 'array',
      description:
        'Parallel mode: independent {agent, task} entries run concurrently. ' +
        'One failing entry does not affect the others.',
      items: {
        type: 'object',
        properties: {
          agent: {
            type: 'string',
            description: 'Agent profile to delegate to.',
          },
          task: { type: 'string', description: 'Complete, self-contained task description.' },
        },
        required: ['agent', 'task'],
        additionalProperties: false,
      },
    },
  },
  additionalProperties: false,
};
