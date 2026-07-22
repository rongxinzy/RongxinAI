export type StreamingMarkdownSegments = {
  committed: string;
  tail: string;
};

const getLastStableBoundary = (content: string): number => {
  let boundary = 0;
  let fence: { character: string; length: number } | null = null;
  let offset = 0;

  for (const line of content.split(/(?<=\n)/)) {
    offset += line.length;
    const fenceMatch = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      if (!fence) {
        fence = { character: marker[0], length: marker.length };
      } else if (marker[0] === fence.character && marker.length >= fence.length) {
        fence = null;
        boundary = offset;
      }
      continue;
    }

    if (!fence && line.trim().length === 0) {
      boundary = offset;
    }
  }

  return boundary;
};

/**
 * Commits only complete Markdown blocks while a response is streaming. The
 * mutable tail remains small and is the only portion re-rendered per update.
 */
export class StreamingMarkdownSegmenter {
  private committed = '';
  private tail = '';
  private previousContent = '';
  private wasStreaming = false;

  update(content: string, isStreaming: boolean): StreamingMarkdownSegments {
    if (!isStreaming) {
      this.committed = content;
      this.tail = '';
      this.previousContent = content;
      this.wasStreaming = false;
      return this.snapshot();
    }

    const isAppend = this.wasStreaming && content.startsWith(this.previousContent);
    if (isAppend) {
      this.tail += content.slice(this.previousContent.length);
    } else {
      this.committed = '';
      this.tail = content;
    }

    this.previousContent = content;
    this.wasStreaming = true;
    const boundary = getLastStableBoundary(this.tail);
    if (boundary > 0) {
      this.committed += this.tail.slice(0, boundary);
      this.tail = this.tail.slice(boundary);
    }

    return this.snapshot();
  }

  private snapshot(): StreamingMarkdownSegments {
    return { committed: this.committed, tail: this.tail };
  }
}
