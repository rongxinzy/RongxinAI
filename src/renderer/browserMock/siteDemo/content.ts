/**
 * Localized conversation, project and skill content for the official-site demo.
 * Realistic, consistent office work only: no test strings and no enterprise content.
 */
import type { Skill } from '../../types/skill';
import type { MockSession, MockWorkspace } from '../fixtures';

export type SiteDemoLang = 'zh' | 'en';
type SiteMessage = MockSession['messages'][number];

export const SITE_NOW = Date.UTC(2026, 9, 16, 7, 0, 0);
const MIN = 60_000;
const HOUR = 60 * MIN;
const DEMO_HOME = '/Users/lin/Documents';

export function pick(lang: SiteDemoLang, zh: string, en: string): string {
  return lang === 'zh' ? zh : en;
}

export function siteWorkspaces(lang: SiteDemoLang): MockWorkspace[] {
  const ws = (id: string, zh: string, en: string, dir: string, ageHours: number) => ({
    id,
    name: pick(lang, zh, en),
    path: `${DEMO_HOME}/${dir}`,
    folders: [],
    isHidden: false,
    pinned: id === 'ws-q3',
    createdAt: SITE_NOW - ageHours * 4 * HOUR,
    updatedAt: SITE_NOW - ageHours * HOUR,
  });
  return [
    ws('ws-q3', '季度经营分析', 'Quarterly Review', 'quarterly-review', 0.3),
    ws('ws-web', '官网改版', 'Website Refresh', 'website-refresh', 3),
    ws('ws-notes', '会议纪要', 'Meeting Notes', 'meeting-notes', 26),
  ];
}

function reportMessages(lang: SiteDemoLang): SiteMessage[] {
  const messages: SiteMessage[] = [];
  const push = (message: Omit<SiteMessage, 'sequence' | 'timestamp'>) => {
    const sequence = messages.length + 1;
    messages.push({ ...message, sequence, timestamp: SITE_NOW - 40 * MIN + sequence * 20_000 });
  };
  push({
    id: 'r-u1',
    type: 'user',
    content: pick(
      lang,
      '根据 sales_q3.xlsx 和 7 月以来的周报写第三季度销售分析报告，指出主要问题并给出建议，输出 Word 文档。',
      'Using sales_q3.xlsx and the weekly reports since July, write a Q3 sales analysis report with the main issues and recommendations, as a Word document.',
    ),
  });
  push({
    id: 'r-th',
    type: 'assistant',
    content: pick(
      lang,
      '先读取销售数据和周报，再计算各区域同比，最后按报告结构成文。',
      'Read the sales data and weekly reports first, compute year-over-year by region, then write the report.',
    ),
    metadata: { isThinking: true, thinkingDurationMs: 6400 },
  });
  const tool = (
    id: string,
    toolName: string,
    toolInput: Record<string, string>,
    result: string,
  ) => {
    push({
      id: `${id}-u`,
      type: 'tool_use',
      content: '',
      metadata: { toolName, toolInput, toolUseId: id },
    });
    push({
      id: `${id}-r`,
      type: 'tool_result',
      content: result,
      metadata: { toolName, toolResult: result, toolUseId: id },
    });
  };
  tool(
    't1',
    'read',
    { path: 'data/sales_q3.xlsx' },
    pick(lang, '读取 3 个工作表，共 1,284 行订单记录', 'Read 3 sheets, 1,284 order rows'),
  );
  tool(
    't2',
    'read',
    { path: 'weekly-reports/' },
    pick(
      lang,
      '读取 13 份周报（7 月 3 日 – 9 月 25 日）',
      'Read 13 weekly reports (Jul 3 – Sep 25)',
    ),
  );
  tool(
    't3',
    'bash',
    { command: 'python analyze_q3.py --by region --compare 2025Q3' },
    pick(
      lang,
      '华东 +18.4%，华南 +6.1%，华北 −4.7%，西南 +11.2%',
      'East +18.4%, South +6.1%, North −4.7%, Southwest +11.2%',
    ),
  );
  tool(
    't4',
    'write',
    { path: 'output/Q3-sales-report.docx' },
    pick(lang, '已写入 12 页，含 4 张图表', 'Wrote 12 pages with 4 charts'),
  );
  push({
    id: 'r-final',
    type: 'assistant',
    metadata: { isFinalAnswer: true },
    content: pick(
      lang,
      '报告已生成：`output/Q3-sales-report.docx`（12 页，4 张图表）。第三季度营收 **4,826 万元**，同比增长 **9.8%**；毛利率 **31.2%**，环比下降 1.4 个百分点。华北渠道库存、9 月集中促销和新客占比下滑是三个主要问题，建议与分区域行动计划见报告第 4 节。',
      'The report is ready: `output/Q3-sales-report.docx` (12 pages, 4 charts). Q3 revenue reached **$6.71M**, up **9.8%** year over year, with a **31.2%** gross margin, down 1.4 points from Q2. North channel inventory, September-heavy promotions and a shrinking share of new customers are the three main issues; recommendations and a regional plan are in section 4.',
    ),
  });
  return messages;
}

function exchange(id: string, user: string, answer: string): SiteMessage[] {
  const at = SITE_NOW - 3 * HOUR;
  return [
    { id: `${id}-u`, type: 'user', content: user, timestamp: at, sequence: 1 },
    {
      id: `${id}-a`,
      type: 'assistant',
      content: answer,
      timestamp: at + 30_000,
      sequence: 2,
      metadata: { isFinalAnswer: true },
    },
  ];
}

export function siteSessions(lang: SiteDemoLang): MockSession[] {
  const paths = new Map(siteWorkspaces(lang).map(ws => [ws.id, ws.path]));
  const session = (
    id: string,
    title: string,
    workspaceId: string,
    ageHours: number,
    messages: SiteMessage[],
    source: MockSession['source'] = 'manual',
  ): MockSession => ({
    id,
    title,
    status: 'completed',
    pinned: false,
    cwd: paths.get(workspaceId) ?? DEMO_HOME,
    systemPrompt: '',
    modelOverride: '',
    executionMode: 'auto',
    activeSkillIds: [],
    workspaceId,
    agentId: 'main',
    source,
    mode: 'work',
    messages,
    messagesOffset: 0,
    totalMessages: messages.length,
    createdAt: SITE_NOW - (ageHours + 0.5) * HOUR,
    updatedAt: SITE_NOW - ageHours * HOUR,
  });
  return [
    session(
      'demo-report',
      pick(lang, '撰写第三季度销售分析报告', 'Write the Q3 sales analysis report'),
      'ws-q3',
      0.3,
      reportMessages(lang),
    ),
    session(
      'demo-budget',
      pick(lang, '核对各区域预算执行表', 'Reconcile the regional budget sheet'),
      'ws-q3',
      4,
      exchange(
        'b',
        pick(
          lang,
          '核对 budget_2026.xlsx 各区域预算执行率',
          'Check budget execution by region in budget_2026.xlsx',
        ),
        pick(
          lang,
          '已核对 6 个区域，华北执行率 71%，低于目标。',
          'Checked 6 regions; North is at 71% execution, below target.',
        ),
      ),
    ),
    session(
      'demo-code',
      pick(lang, '修复登录表单校验并补充单元测试', 'Fix login form validation and add unit tests'),
      'ws-web',
      2.5,
      exchange(
        'c',
        pick(
          lang,
          '登录页邮箱校验不生效，修复并补测试',
          'Email validation on the login page is not working; fix it and add tests',
        ),
        pick(
          lang,
          '已修复 `LoginForm.tsx` 的校验逻辑，新增 6 个测试用例，全部通过。',
          'Fixed the validation in `LoginForm.tsx` and added 6 test cases; all pass.',
        ),
      ),
    ),
    session(
      'demo-notes',
      pick(lang, '整理 10 月 15 日周会纪要', 'Write up the Oct 15 weekly meeting'),
      'ws-notes',
      25,
      exchange(
        'l',
        pick(
          lang,
          '把 10 月 15 日周会转写整理成纪要和待办',
          'Turn the Oct 15 meeting transcript into notes and action items',
        ),
        pick(
          lang,
          '纪要已写入 `2026-10-15-周会.md`，共 7 项待办。',
          'Notes saved to `2026-10-15-weekly.md` with 7 action items.',
        ),
      ),
    ),
  ];
}

export function siteSkills(lang: SiteDemoLang): Skill[] {
  const skill = (
    id: string,
    zh: [string, string],
    en: [string, string],
    extra: Partial<Skill> = {},
  ): Skill => ({
    id,
    name: id,
    displayName: pick(lang, zh[0], en[0]),
    description: pick(lang, zh[1], en[1]),
    enabled: true,
    pinned: false,
    isOfficial: true,
    isBuiltIn: true,
    updatedAt: SITE_NOW - 24 * HOUR,
    prompt: '',
    skillPath: `/Applications/ZhiYuan.app/SKILLs/${id}/SKILL.md`,
    ...extra,
  });
  return [
    skill(
      'docx',
      ['Word 文档', '创建、编辑和排版 Word 文档，支持修订与批注。'],
      [
        'Word documents',
        'Create, edit and format Word documents with tracked changes and comments.',
      ],
      { pinned: true },
    ),
    skill(
      'xlsx',
      ['电子表格', '读取、清洗和分析 Excel 数据，生成透视表与图表。'],
      ['Spreadsheets', 'Read, clean and analyze Excel data; build pivot tables and charts.'],
      { pinned: true },
    ),
    skill(
      'pptx',
      ['演示文稿', '根据大纲生成演示文稿，统一版式与配色。'],
      ['Presentations', 'Generate slide decks from an outline with consistent layouts.'],
    ),
    skill(
      'pdf',
      ['PDF 处理', '提取 PDF 文字与表格，合并、拆分和填写表单。'],
      ['PDF tools', 'Extract text and tables, merge, split and fill PDF forms.'],
    ),
    skill(
      'weekly-report',
      ['周报撰写', '汇总本周任务与数据，按模板生成周报。'],
      ['Weekly reports', "Compile the week's tasks and metrics into a report template."],
    ),
    skill(
      'data-cleaning',
      ['数据清洗', '去重、补全缺失值并统一字段格式。'],
      ['Data cleaning', 'Deduplicate, fill missing values and normalize fields.'],
    ),
    skill(
      'code-review',
      ['代码审查', '审查改动的正确性、风格与测试覆盖。'],
      ['Code review', 'Review changes for correctness, style and test coverage.'],
    ),
    skill(
      'web-research',
      ['联网调研', '检索公开资料并整理成带来源的摘要。'],
      ['Web research', 'Search public sources and summarize them with citations.'],
      { isBuiltIn: false },
    ),
    skill(
      'meeting-notes',
      ['会议纪要', '把转写文本整理为纪要、决议与待办。'],
      ['Meeting notes', 'Turn transcripts into notes, decisions and action items.'],
    ),
    skill(
      'contract-review',
      ['合同审阅', '标出合同中的风险条款并给出修改建议。'],
      ['Contract review', 'Flag risky clauses in contracts and suggest edits.'],
    ),
  ];
}
