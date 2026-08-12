export interface WorkbenchMessageArtifactBlock {
  index: number;
  explicit: boolean;
  language: string;
  title?: string;
  content: string;
}

export function discoverWorkbenchMessageArtifactBlocks(
  messageContent: string,
): WorkbenchMessageArtifactBlock[] {
  if (!messageContent) return [];
  const blocks: WorkbenchMessageArtifactBlock[] = [];
  const pattern = /```(artifact:)?([^\s`]+)(?:\s+title="([^"]*)")?\s*\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(messageContent)) !== null) {
    blocks.push({
      index: blocks.length,
      explicit: Boolean(match[1]),
      language: match[2].trim().toLowerCase(),
      title: match[3] || undefined,
      content: match[4].trimEnd(),
    });
  }
  return blocks;
}
