import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { LiveFixture } from './piNativeABRunner';

const inputFiles = ['input/east.csv', 'input/south.csv', 'input/west.csv'];
const outputFile = 'result.json';

const prompt = `请用 read 工具读取 input/ 目录内的 east.csv、south.csv、west.csv（可以并行读取），核对所有记录后用 write 工具生成 result.json。每个文件格式均为 id,owner,severity,loss，loss 单位为元。纳入 severity 为 P0 或 loss 大于等于 5000 的记录。result.json 必须是一个 JSON 对象，字段为 findings 和 ownerTotals。findings 是按 id 升序排列的数组，每项为 {"id":字符串,"owner":字符串,"loss":数字}。ownerTotals 是以负责人为键的对象，值为该负责人命中记录的 loss 总和。保留原数据，不要新增其他文件。完成后简短说明。`;

async function seed(root: string, variant: number, stress: boolean) {
  const rows = [
    [
      ['EA-18', '王宁', 'P0', 2100],
      ['EA-26', '胡敏', 'P2', 4999],
    ],
    [
      ['SO-27', '胡敏', 'P1', 5000],
      ['SO-39', '王宁', 'P2', 7100],
    ],
    [
      ['WE-19', '余安', 'P2', 200],
      ['WE-28', '余安', 'P0', 1400],
      ['WE-41', '胡敏', 'P3', 5700],
    ],
  ] as const;
  await mkdir(path.join(root, 'input'));
  const normalized = rows.map(group =>
    group.map(([id, owner, severity, loss]) => ({
      id,
      owner,
      severity,
      loss: loss + variant * 100,
    })),
  );
  const inputs = new Map<string, string>();
  for (const [index, file] of inputFiles.entries()) {
    const excludedRows = stress
      ? Array.from(
          { length: 350 },
          (_, row) =>
            `ZZ-${index}-${row},日常基准巡检记录此条未达到阈值仅供验证上下文分段处理编号${row},P3,100`,
        )
      : [];
    const content = [
      'id,owner,severity,loss',
      ...normalized[index].map(row => `${row.id},${row.owner},${row.severity},${row.loss}`),
      ...excludedRows,
      '',
    ].join('\n');
    inputs.set(file, content);
    await writeFile(path.join(root, file), content);
  }
  const findings = normalized
    .flat()
    .filter(row => row.severity === 'P0' || row.loss >= 5000)
    .map(({ id, owner, loss }) => ({ id, owner, loss }));
  const ownerTotals: Record<string, number> = {};
  for (const { owner, loss } of findings) ownerTotals[owner] = (ownerTotals[owner] ?? 0) + loss;
  return { inputs, expected: { findings, ownerTotals } };
}

function isFixtureTool(workspace: string, tool: string, input: Record<string, unknown>): boolean {
  if (typeof input.path !== 'string') return false;
  const relative = path
    .relative(workspace, path.resolve(workspace, input.path))
    .split(path.sep)
    .join('/');
  return (
    (tool === 'read' && inputFiles.includes(relative)) ||
    (tool === 'write' && relative === outputFile)
  );
}

export async function csvFixture(
  cwd: string,
  variant: number,
  stress = false,
): Promise<LiveFixture> {
  const { expected, inputs } = await seed(cwd, variant, stress);
  return {
    prompt,
    allowTool: (tool, input) => isFixtureTool(cwd, tool, input),
    score: async () => {
      const actual = await readJsonArtifact(cwd);
      const files = (await readdir(cwd, { recursive: true }))
        .map(file => file.split(path.sep).join('/'))
        .sort();
      const expectedFiles = ['input', ...inputFiles, outputFile].sort();
      const unchanged = await Promise.all(
        [...inputs].map(async ([file, content]) =>
          readFile(path.join(cwd, file), 'utf8').then(
            actual => actual === content,
            () => false,
          ),
        ),
      );
      return {
        actual,
        expected,
        inputsUnchanged: unchanged.every(Boolean),
        onlyExpectedFiles: files.join('\n') === expectedFiles.join('\n'),
      };
    },
  };
}

export function readJsonArtifact(cwd: string): Promise<unknown> {
  return readFile(path.join(cwd, outputFile), 'utf8')
    .then(text => JSON.parse(text) as unknown)
    .catch((): null => null);
}
