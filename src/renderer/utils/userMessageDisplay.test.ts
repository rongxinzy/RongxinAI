import { describe, expect, test } from 'vitest';

import { parseUserMessageForDisplay } from './userMessageDisplay';

describe('parseUserMessageForDisplay', () => {
  test('passes through plain text, markdown, and file paths', () => {
    expect(parseUserMessageForDisplay('你好，今天天气不错')).toBe('你好，今天天气不错');
    expect(parseUserMessageForDisplay('## Hello\n\n- item')).toBe('## Hello\n\n- item');
    expect(parseUserMessageForDisplay(String.raw`C:\Users\test\screenshot.jpg`)).toBe(
      String.raw`C:\Users\test\screenshot.jpg`,
    );
  });

  test('removes channel media placeholders while preserving their URLs', () => {
    const input = [
      '请看这张图',
      '[图片] https://example.com/image.jpg',
      '',
      '[附件信息]',
      '- 类型: image, 路径: C:\\media\\image.jpg, MIME: image/jpeg',
    ].join('\n');

    expect(parseUserMessageForDisplay(input)).toBe(
      '请看这张图\nhttps://example.com/image.jpg',
    );
  });

  test('removes standalone media placeholders without URLs', () => {
    expect(parseUserMessageForDisplay('[语音消息]')).toBe('');
    expect(parseUserMessageForDisplay('[视频]')).toBe('');
    expect(parseUserMessageForDisplay('[文件]')).toBe('');
  });

  test('removes channel timestamp metadata and preserves user content', () => {
    const input = [
      'System: [2026-04-28 11:53:11 GMT+8] From user889589',
      '',
      'hello',
    ].join('\n');

    expect(parseUserMessageForDisplay(input)).toBe('hello');
  });

  test('does not strip ordinary System text', () => {
    expect(parseUserMessageForDisplay('System: this is user text')).toBe(
      'System: this is user text',
    );
  });

  test('does not interpret retired runtime attachment syntax', () => {
    const input = '[media attached: C:\\legacy\\image.jpg (image/jpeg)]';
    expect(parseUserMessageForDisplay(input)).toBe(input);
  });

  test('normalizes CRLF before applying display transformations', () => {
    const input = '[图片] https://example.com/image.jpg\r\n\r\n[附件信息]\r\n- 类型: image';
    expect(parseUserMessageForDisplay(input)).toBe('https://example.com/image.jpg');
  });
});
