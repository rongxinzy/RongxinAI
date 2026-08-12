/**
 * Display-only transformation for user messages received from channel transports.
 * It removes transport metadata without changing the content sent to the model.
 */

const MEDIA_PLACEHOLDER_RE =
  /^\[(图片|语音消息|视频|文件|多媒体消息)\](?:\s+(https?:\/\/\S+))?\s*$/m;

const ATTACHMENT_INFO_BLOCK_RE = /\n?\[附件信息\]\n(?:- .+(?:\n|$))+/;

// Channel transports may add timestamp metadata. The timestamp format is
// specific enough to avoid stripping normal user-authored text.
const SYSTEM_TIMESTAMP_LINE_RE =
  /^System(?:\s*\(untrusted\))?:\s*\[\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\s+[^\]]*\].*$/gm;

export function parseUserMessageForDisplay(content: string): string {
  if (!content) return content;

  let result = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  if (
    result.includes('[图片]') ||
    result.includes('[语音消息]') ||
    result.includes('[视频]') ||
    result.includes('[文件]') ||
    result.includes('[多媒体消息]') ||
    result.includes('[附件信息]')
  ) {
    result = result.replace(MEDIA_PLACEHOLDER_RE, (_match, _type, url) => url || '');
    result = result.replace(ATTACHMENT_INFO_BLOCK_RE, '');
  }

  result = result.replace(SYSTEM_TIMESTAMP_LINE_RE, '');
  return result.replace(/\n{3,}/g, '\n\n').trim();
}
