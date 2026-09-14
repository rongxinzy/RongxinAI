export const WorkspaceLineEnding = {
  Lf: '\n',
  CrLf: '\r\n',
} as const;
export type WorkspaceLineEnding = (typeof WorkspaceLineEnding)[keyof typeof WorkspaceLineEnding];

export const normalizeWorkspaceFileContent = (content: string): string =>
  content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

export const detectWorkspaceLineEnding = (content: string): WorkspaceLineEnding =>
  content.includes(WorkspaceLineEnding.CrLf)
    ? WorkspaceLineEnding.CrLf
    : WorkspaceLineEnding.Lf;

export const serializeWorkspaceFileContent = (
  content: string,
  lineEnding: WorkspaceLineEnding,
): string => {
  const normalized = normalizeWorkspaceFileContent(content);
  return lineEnding === WorkspaceLineEnding.CrLf
    ? normalized.replace(/\n/g, WorkspaceLineEnding.CrLf)
    : normalized;
};
