import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';
import { inspectLongTaskArtifacts } from './piLongTaskAcceptance';

test('rejects the reported partial task, missing deliveries, short report and wrong ordering', () => {
  const workDir = mkdtempSync(path.join(tmpdir(), 'pi-acceptance-'));
  const ids = Array.from({ length: 32 }, (_, i) => `doc-${String(i + 1).padStart(3, '0')}`);
  const summary = (values: string[]) => values.map(id => `## ${id} 章节\n内容。`).join('\n');
  const csv = (values: string[]) =>
    [
      '文档编号,章节名,主题分类,一句话要点',
      ...values.map(id => `${id},"章节,名称",分类,"跨行\n要点"`),
    ].join('\r\n');
  try {
    writeFileSync(path.join(workDir, 'summaries.md'), summary(ids.slice(0, 18)));
    expect(inspectLongTaskArtifacts(workDir, 32)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('summaries.md'),
        expect.stringContaining('index.csv'),
        expect.stringContaining('report.md'),
      ]),
    );
    writeFileSync(path.join(workDir, 'summaries.md'), summary(ids));
    writeFileSync(path.join(workDir, 'index.csv'), csv(ids));
    writeFileSync(path.join(workDir, 'report.md'), '分析'.repeat(750));
    expect(inspectLongTaskArtifacts(workDir, 32)).toEqual([]);
    writeFileSync(path.join(workDir, 'summaries.md'), summary([...ids].reverse()));
    writeFileSync(path.join(workDir, 'index.csv'), csv([...ids.slice(0, 31), ids[0]]));
    writeFileSync(path.join(workDir, 'report.md'), 'short report');
    expect(inspectLongTaskArtifacts(workDir, 32)).toHaveLength(3);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});
