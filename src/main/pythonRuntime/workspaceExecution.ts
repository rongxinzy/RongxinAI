import { isolatedEnvironment, type ProcessResult } from './process';

/** Only host-owned runtime locations cross the Skill boundary, never secrets or Python overrides. */
export function buildWorkspaceExecutionEnv(
  cache: string,
  skillEnv?: Record<string, string | undefined>,
): NodeJS.ProcessEnv {
  const env = isolatedEnvironment(cache);
  for (const key of [
    'PATH',
    'SKILLS_ROOT',
    'ZHIYUAN_SKILLS_ROOT',
    'ZHIYUAN_ELECTRON_PATH',
    'ZHIYUAN_NPM_BIN_DIR',
    'ZHIYUAN_NODE_SHIM_ACTIVE',
    'NODE_PATH',
    'HTTP_PROXY',
    'HTTPS_PROXY',
    'ALL_PROXY',
    'NO_PROXY',
    'http_proxy',
    'https_proxy',
    'all_proxy',
    'no_proxy',
    'SSL_CERT_FILE',
    'SSL_CERT_DIR',
  ]) {
    if (skillEnv?.[key]) env[key] = skillEnv[key];
  }
  return env;
}

/** Runs in the supervised Runner, using the same interpreter and installed metadata as the Skill. */
export async function missingRequirements(
  python: string,
  requirements: string[],
  run: (command: string, args: string[]) => Promise<ProcessResult>,
): Promise<string[]> {
  if (!requirements.length) return [];
  const checked = await run(python, [
    '-c',
    [
      'import importlib.metadata as metadata,json,sys',
      'from packaging.requirements import Requirement',
      'missing=[]',
      'for text in json.loads(sys.argv[1]):',
      '    requirement=Requirement(text)',
      '    if requirement.marker is not None and not requirement.marker.evaluate(): continue',
      '    try:',
      '        version=metadata.version(requirement.name)',
      '        if not requirement.specifier.contains(version, prereleases=True): missing.append(text)',
      '    except metadata.PackageNotFoundError: missing.append(text)',
      'print(json.dumps(missing))',
    ].join('\n'),
    JSON.stringify(requirements),
  ]);
  if (checked.exitCode !== 0)
    throw new Error(`Unable to inspect Skill dependencies: ${checked.stderr}`);
  const missing: unknown = JSON.parse(checked.stdout);
  if (
    !Array.isArray(missing) ||
    missing.some(value => typeof value !== 'string' || !requirements.includes(value))
  )
    throw new Error('Invalid Python dependency inspection result.');
  return missing;
}

export async function requirementsSatisfied(
  python: string,
  requirements: string[],
  run: (command: string, args: string[]) => Promise<ProcessResult>,
): Promise<boolean> {
  return (await missingRequirements(python, requirements, run)).length === 0;
}
