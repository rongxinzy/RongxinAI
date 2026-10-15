import { expect, test } from 'vitest';

import {
  checkPathExistsCached,
  clearPathExistsCache,
  getCachedPathExists,
  hasLikelyFileExtension,
  isLikelyLocalFilePath,
  isWorkspaceFileRef,
  linkifyLocalPathsInMarkdown,
  LocalPathHref,
  parseLocalPathHref,
  resolveOpenableLocalPath,
  stripFileProtocol,
  toFileHref,
} from './localFilePathLinks';

test('detects windows and file urls as local paths', () => {
  expect(isLikelyLocalFilePath('C:/Users/Administrator/.zhiyuan/scratch/销售简历.html')).toBe(true);
  expect(isLikelyLocalFilePath('C:\\Users\\a\\b.html')).toBe(true);
  expect(isLikelyLocalFilePath('file:///C:/Users/a/b.html')).toBe(true);
  expect(isLikelyLocalFilePath('https://example.com/a.html')).toBe(false);
  expect(
    isLikelyLocalFilePath(`${LocalPathHref.Prefix}${encodeURIComponent('D:/project/测试数据')}`),
  ).toBe(true);
});

test('toFileHref uses harden-safe https synthetic links, not file://', () => {
  const href = toFileHref('D:/project/测试数据');
  expect(href.startsWith(LocalPathHref.Prefix)).toBe(true);
  expect(href.includes('file:')).toBe(false);
  expect(parseLocalPathHref(href)).toBe('D:/project/测试数据');
});

test('linkifies inline-code windows paths in markdown', () => {
  const input = '简历已生成，文件位置：`C:/Users/Administrator/.zhiyuan/scratch/销售简历.html`';
  const out = linkifyLocalPathsInMarkdown(input);
  expect(out).toContain('[C:/Users/Administrator/.zhiyuan/scratch/销售简历.html](');
  expect(out).toContain(LocalPathHref.Prefix);
  expect(out).not.toContain('file:///');
});

test('linkifies bare windows paths after chinese punctuation', () => {
  // 带扩展名才链；无后缀目录保持纯文本
  const withFile = linkifyLocalPathsInMarkdown('文件位置：D:/project/测试数据/a.txt 可打开');
  expect(withFile).toContain('[D:/project/测试数据/a.txt](');
  expect(withFile).toContain(LocalPathHref.Prefix);
  expect(withFile).not.toContain('[blocked]');

  const dirOnly = linkifyLocalPathsInMarkdown('文件位置：D:/project/测试数据 可打开');
  expect(dirOnly).not.toContain(LocalPathHref.Prefix);
  expect(dirOnly).toContain('D:/project/测试数据');
});

test('toFileHref and stripFileProtocol round-trip windows paths', () => {
  expect(toFileHref('C:\\tmp\\a.html')).toBe(
    `${LocalPathHref.Prefix}${encodeURIComponent('C:/tmp/a.html')}`,
  );
  expect(stripFileProtocol('file:///C:/tmp/a.html')).toBe('C:/tmp/a.html');
});

test('resolveOpenableLocalPath prefers resolveLocalFilePath callback', () => {
  expect(resolveOpenableLocalPath('rel/a.html', 'a.html', () => 'C:/workspace/rel/a.html')).toBe(
    'C:/workspace/rel/a.html',
  );
  expect(resolveOpenableLocalPath('C:/tmp/a.html', 'a.html')).toBe('C:/tmp/a.html');
});

test('resolveOpenableLocalPath decodes synthetic https local-path hrefs', () => {
  const href = toFileHref('D:/project/测试数据/a.txt');
  expect(resolveOpenableLocalPath(href, 'D:/project/测试数据/a.txt')).toBe(
    'D:/project/测试数据/a.txt',
  );
  expect(
    resolveOpenableLocalPath(href, '显示文本', candidate =>
      candidate === 'D:/project/测试数据/a.txt' ? candidate : null,
    ),
  ).toBe('D:/project/测试数据/a.txt');
});

test('detects bare workspace filenames with any file extension', () => {
  expect(isWorkspaceFileRef('季度工作汇报_Q3_2024.pptx')).toBe(true);
  expect(isWorkspaceFileRef('销售简历.html')).toBe(true);
  expect(isWorkspaceFileRef('output/报告.docx')).toBe(true);
  expect(isWorkspaceFileRef('4f22e59ccb5945d28b1799464b67d036.mp3')).toBe(true);
  expect(isWorkspaceFileRef('clip.wav')).toBe(true);
  expect(isWorkspaceFileRef('D:/project/测试数据/a.txt')).toBe(true);
  expect(isWorkspaceFileRef('D:/project/测试数据')).toBe(false);
  expect(isWorkspaceFileRef('react.useState')).toBe(false);
  expect(isWorkspaceFileRef('https://example.com/a.html')).toBe(false);
});

test('linkifies bare and inline-code workspace filenames', () => {
  const inline = linkifyLocalPathsInMarkdown('已生成：`季度工作汇报_Q3_2024.pptx`');
  expect(inline).toContain('[季度工作汇报_Q3_2024.pptx](');
  expect(inline).toContain(LocalPathHref.Prefix);

  const bare = linkifyLocalPathsInMarkdown('请打开 销售简历.html 查看');
  expect(bare).toContain('[销售简历.html](');
  expect(bare).toContain(LocalPathHref.Prefix);

  const mp3 = linkifyLocalPathsInMarkdown(
    '找到了一个 MP3 文件： `4f22e59ccb5945d28b1799464b67d036.mp3` （约 668KB）。',
  );
  expect(mp3).toContain('[4f22e59ccb5945d28b1799464b67d036.mp3](');
  expect(mp3).toContain(LocalPathHref.Prefix);
  expect(mp3).not.toContain('`4f22e59ccb5945d28b1799464b67d036.mp3`');
});

test('rejects size and percentage lookalikes', () => {
  expect(isWorkspaceFileRef('1.42GB')).toBe(false);
  expect(isWorkspaceFileRef('1.3GB')).toBe(false);
  expect(isWorkspaceFileRef('93%')).toBe(false);
  expect(hasLikelyFileExtension('1.42GB')).toBe(false);
  expect(linkifyLocalPathsInMarkdown('已下载完成（1.42GB）')).not.toContain(LocalPathHref.Prefix);
  expect(linkifyLocalPathsInMarkdown('进度 93%')).not.toContain(LocalPathHref.Prefix);
});

test('resolveOpenableLocalPath resolves bare filenames via callback (cwd join)', () => {
  expect(
    resolveOpenableLocalPath(toFileHref('销售简历.html'), '销售简历.html', candidate =>
      candidate === '销售简历.html' ? 'D:/project/测试数据/销售简历.html' : null,
    ),
  ).toBe('D:/project/测试数据/销售简历.html');
});

test('checkPathExistsCached deduplicates concurrent checks and caches results', async () => {
  clearPathExistsCache();
  let calls = 0;
  const anyGlobal = globalThis as unknown as {
    window?: {
      electron?: {
        shell?: { pathExists?: (p: string) => Promise<{ success: boolean; exists: boolean }> };
      };
    };
  };
  const origElectron = anyGlobal.window?.electron;
  anyGlobal.window = anyGlobal.window || {};
  anyGlobal.window.electron = {
    shell: {
      pathExists: async (p: string) => {
        calls++;
        await new Promise(r => setTimeout(r, 10));
        return { success: true, exists: p.endsWith('exist.txt') };
      },
    },
  };

  try {
    expect(getCachedPathExists('/path/to/exist.txt')).toBeUndefined();

    // Trigger 5 concurrent checks for the same path
    const results = await Promise.all([
      checkPathExistsCached('/path/to/exist.txt'),
      checkPathExistsCached('/path/to/exist.txt'),
      checkPathExistsCached('/path/to/exist.txt'),
      checkPathExistsCached('/path/to/exist.txt'),
      checkPathExistsCached('/path/to/exist.txt'),
    ]);

    expect(results).toEqual([true, true, true, true, true]);
    expect(calls).toBe(1); // Only 1 IPC call made!

    // Subsequent sync read is cached
    expect(getCachedPathExists('/path/to/exist.txt')).toBe(true);

    // Subsequent async call returns cached without invoking IPC
    const nextResult = await checkPathExistsCached('/path/to/exist.txt');
    expect(nextResult).toBe(true);
    expect(calls).toBe(1);

    // Negative check
    const nonExist = await checkPathExistsCached('/path/to/missing.txt');
    expect(nonExist).toBe(false);
    expect(calls).toBe(2);
    expect(getCachedPathExists('/path/to/missing.txt')).toBe(false);
  } finally {
    clearPathExistsCache();
    if (origElectron) {
      anyGlobal.window.electron = origElectron;
    } else {
      delete anyGlobal.window?.electron;
    }
  }
});

test('parseLocalPathHref rejects paths with null bytes or control characters', () => {
  const nullByteHref = `${LocalPathHref.Prefix}${encodeURIComponent('/workspace/exploit\0.txt')}`;
  expect(parseLocalPathHref(nullByteHref)).toBeNull();

  const newlineHref = `${LocalPathHref.Prefix}${encodeURIComponent('/workspace/file\nname.txt')}`;
  expect(parseLocalPathHref(newlineHref)).toBeNull();

  expect(parseLocalPathHref('file:///C:/safe\0file.txt')).toBeNull();
});
