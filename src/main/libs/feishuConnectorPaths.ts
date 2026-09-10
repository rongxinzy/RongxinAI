import path from 'path';

export const FeishuConnectorPath = {
  McpsDirectory: 'MCPs',
  FeishuDirectory: 'feishu',
  CliDirectory: 'cli',
  CliBinDirectory: 'bin',
  SkillsDirectory: 'skills',
  NodeModulesDirectory: 'node_modules',
  RuntimeManifestFile: 'runtime-manifest.json',
} as const;

export function getFeishuCliRoot(userDataPath: string): string {
  return path.join(
    userDataPath,
    FeishuConnectorPath.McpsDirectory,
    FeishuConnectorPath.FeishuDirectory,
    FeishuConnectorPath.CliDirectory,
  );
}

export function getFeishuCliBinDirectory(userDataPath: string): string {
  return path.join(getFeishuCliRoot(userDataPath), FeishuConnectorPath.CliBinDirectory);
}

export function getFeishuConnectorSkillsRoot(userDataPath: string): string {
  return path.join(
    userDataPath,
    FeishuConnectorPath.McpsDirectory,
    FeishuConnectorPath.FeishuDirectory,
    FeishuConnectorPath.SkillsDirectory,
  );
}
