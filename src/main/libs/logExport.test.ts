import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, test } from 'vitest';
import extract from 'extract-zip';

import { exportLogsZip } from './logExport';

describe('exportLogsZip', () => {
  test('exports both physical files and virtual in-memory entries into a valid zip', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'log-export-test-'));
    const testLogFile = path.join(tmpDir, 'main-test.log');
    fs.writeFileSync(testLogFile, 'log line 1\nlog line 2\n');

    const outputPath = path.join(tmpDir, 'exported.zip');
    const result = await exportLogsZip({
      outputPath,
      entries: [{ archiveName: 'main-2026-10-19.log', filePath: testLogFile }],
      virtualEntries: [
        { archiveName: 'system-diagnostics.json', content: JSON.stringify({ version: '1.0' }) },
        { archiveName: 'summary.txt', content: 'System Summary' },
      ],
    });

    expect(result.exportedEntries).toContain('system-diagnostics.json');
    expect(result.exportedEntries).toContain('summary.txt');
    expect(result.exportedEntries).toContain('main-2026-10-19.log');
    expect(result.missingEntries).toHaveLength(0);
    expect(fs.existsSync(outputPath)).toBe(true);

    // Extract zip and verify contents
    const extractDir = path.join(tmpDir, 'extracted');
    await extract(outputPath, { dir: extractDir });

    expect(fs.existsSync(path.join(extractDir, 'system-diagnostics.json'))).toBe(true);
    expect(fs.existsSync(path.join(extractDir, 'summary.txt'))).toBe(true);
    expect(fs.existsSync(path.join(extractDir, 'main-2026-10-19.log'))).toBe(true);

    const diagContent = fs.readFileSync(path.join(extractDir, 'system-diagnostics.json'), 'utf-8');
    expect(diagContent).toBe('{"version":"1.0"}');

    const summaryContent = fs.readFileSync(path.join(extractDir, 'summary.txt'), 'utf-8');
    expect(summaryContent).toBe('System Summary');

    const logContent = fs.readFileSync(path.join(extractDir, 'main-2026-10-19.log'), 'utf-8');
    expect(logContent).toBe('log line 1\nlog line 2\n');

    // Cleanup
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('marks missing physical files as missingEntries while preserving zip integrity', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'log-export-missing-test-'));
    const outputPath = path.join(tmpDir, 'missing-test.zip');

    const result = await exportLogsZip({
      outputPath,
      entries: [
        { archiveName: 'non-existent.log', filePath: path.join(tmpDir, 'does-not-exist.log') },
      ],
      virtualEntries: [{ archiveName: 'report.txt', content: 'ok' }],
    });

    expect(result.missingEntries).toContain('non-existent.log');
    expect(result.exportedEntries).toContain('report.txt');
    expect(fs.existsSync(outputPath)).toBe(true);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
