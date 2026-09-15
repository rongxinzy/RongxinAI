import { describe, expect, test } from 'vitest';

import {
  formatModelLaunchLogLine,
  formatModelLaunchLogText,
} from './logFormatting';

describe('model launch log formatting', () => {
  test('keeps only the short timestamp prefix and message', () => {
    expect(
      formatModelLaunchLogLine(
        '2026-09-14 17:13:48.711000+08:00 - local_inference.launch - INFO - Startup request received {"modelName":"model"}',
      ),
    ).toBe('09-14 17:13:48: Startup request received {"modelName":"model"}');
  });

  test('supports comma fractions and compact timezone offsets', () => {
    expect(
      formatModelLaunchLogLine('2026-09-14 17:13:48,711+0800 - logger - WARNING - Ready'),
    ).toBe('09-14 17:13:48: Ready');
  });

  test('keeps unprefixed model output unchanged', () => {
    expect(formatModelLaunchLogLine('llama server listening on http://127.0.0.1:8080')).toBe(
      'llama server listening on http://127.0.0.1:8080',
    );
  });

  test('formats each line and preserves blank lines', () => {
    expect(formatModelLaunchLogText('2026-09-14 17:13:48.711000+08:00 - logger - INFO - One\r\n\r\nplain line')).toBe(
      '09-14 17:13:48: One\n\nplain line',
    );
  });
});