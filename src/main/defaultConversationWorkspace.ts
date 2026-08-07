import os from 'os';
import path from 'path';

export const getDefaultConversationWorkspacePath = (): string => {
  return path.join(os.homedir(), '.zhiyuan', 'scratch');
};

export const isDefaultConversationWorkspacePath = (candidatePath: string): boolean => {
  const normalizedCandidatePath = path.resolve(candidatePath);
  const normalizedDefaultPath = path.resolve(getDefaultConversationWorkspacePath());
  return process.platform === 'win32'
    ? normalizedCandidatePath.toLowerCase() === normalizedDefaultPath.toLowerCase()
    : normalizedCandidatePath === normalizedDefaultPath;
};
