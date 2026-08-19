const array = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const stringArray = (value: unknown): string[] =>
  array(value).filter((entry): entry is string => typeof entry === 'string');

export function composeWorkbenchWorkflowSnapshot(input: {
  production?: Record<string, unknown> | null;
  domain?: Record<string, unknown> | null;
}): Record<string, unknown> | null {
  const production = input.production ?? null;
  const domain = input.domain ?? null;
  if (!production) return domain;
  if (!domain) return production;

  return {
    ...production,
    domainWorkflow: domain,
    completionFailures: [
      ...stringArray(domain.completionFailures),
      ...stringArray(production.completionFailures),
    ],
    files: [...array(domain.files), ...array(production.files)],
    artifacts: [...array(domain.artifacts), ...array(production.artifacts)],
  };
}
