'use strict';

const retiredDependencyPattern =
  /@earendil-works\/pi-(?:coding-agent|agent-core)|(?:^|[/@])(?:cc-connect|engram)(?:$|[/@])/i;
const retiredPackagingReferencePattern =
  /(?:vendor[/\\](?:channel-runtime|engram-runtime)|channel:runtime|engram:runtime|cc-connect-sidecar|ZHIYUAN_CC_CONNECT_SOURCE|ZHIYUAN_ALLOW_HOST_CHANNEL_RUNTIME)/i;
const retiredExecutionReferencePattern =
  /@earendil-works\/pi-(?:coding-agent|agent-core)|ENGRAM_HTTP_TOKEN|ZHIYUAN_ENGRAM_BIN|(?:from\s*|require\s*\(|import\s*\()['"][^'"]*(?:engramManager|zhiyuanEngramAdapter|ccConnect(?:Sidecar|Control|Bridge|Request|Runtime))[^'"]*['"]/i;

function retiredRuntimeArtifact(relativePath) {
  const segments = relativePath.replaceAll('\\', '/').split('/');
  return segments.some(
    segment =>
      /^(?:channel-runtime|engram-runtime|pi-coding-agent|pi-agent-core)(?:\.|$)/i.test(segment) ||
      /^(?:cc-connect-sidecar(?:-[a-z0-9-]+)?|engram)(?:\.exe)?$/i.test(segment),
  );
}

function durableManifestViolations(manifest, lock = '') {
  const failures = [];
  if (Object.hasOwn(manifest, 'channelRuntime') || Object.hasOwn(manifest, 'engram'))
    failures.push('retired runtime metadata must not exist');
  const dependencies = {
    ...manifest.dependencies,
    ...manifest.devDependencies,
    ...manifest.optionalDependencies,
  };
  if (!dependencies['@earendil-works/pi-durable'])
    failures.push('Pi Durable must be an explicit dependency');
  if (dependencies['@sigrun/sigrun'])
    failures.push('The Sigrun server must not be installed for the memory plugin');
  for (const name of Object.keys(dependencies))
    if (retiredDependencyPattern.test(name))
      failures.push(`retired dependency ${name} must not exist`);
  for (const [name, command] of Object.entries(manifest.scripts ?? {}))
    if (retiredPackagingReferencePattern.test(`${name} ${command}`))
      failures.push(`script ${name} references a retired runtime`);
  if (/@earendil-works\/pi-(?:coding-agent|agent-core)(?:@|["/])/.test(lock))
    failures.push('lockfile contains a retired Agent execution kernel');
  if (/"@sigrun\/sigrun"\s*:\s*\[/.test(lock))
    failures.push('lockfile installs the Sigrun server instead of its native memory plugin');
  return failures;
}

module.exports = {
  durableManifestViolations,
  retiredExecutionReferencePattern,
  retiredPackagingReferencePattern,
  retiredRuntimeArtifact,
};
