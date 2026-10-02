/**
 * Shared long-task scenario for the Pi provider tape experiment.
 *
 * One deterministic 200-document serial task exercised in three modes:
 *
 * - live:   real provider (manual, AB_LONGTASK=live) — the A/B harness arm.
 * - record: real provider behind the tape server (manual, AB_LONGTASK=record)
 *           — produces the tape consumed by replay.
 * - replay: tape server only (CI, tests/piLongTaskReplay.test.ts) — no model,
 *           strict seq+hash request matching; any drift fails the test.
 *
 * Time is frozen (Date only; timers stay real) so prompts that embed the
 * current date hash identically across record and replay.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app } from 'electron';
import { vi } from 'vitest';
import { ModelCapabilityStatus } from '@shared/providers';
import { WorkbenchApprovalMode } from '@shared/workbenchTask';

import { CoworkExecutionMode } from '../../src/shared/cowork/constants';
import { CoworkStore } from '../../src/main/coworkStore';
import { composeCoworkSystemPrompt } from '../../src/main/coworkPrompt/composer';
import { setStoreGetter } from '../../src/main/libs/claudeSettings';
import { stopPiOpenAICompatProxyForTests } from '../../src/main/libs/agentEngine/piOpenAICompatProxy';
import { PiRuntimeAdapter } from '../../src/main/libs/agentEngine/piRuntimeAdapter';
import { SqliteStore } from '../../src/main/sqliteStore';
import { initializeWorkbenchTaskSchema } from '../../src/main/workbenchTask/schema';
import { WorkbenchTaskService } from '../../src/main/workbenchTask/taskService';
import { PiProviderTapeServer } from './piProviderTape';

// The shared electron mock drifts behind app.* usage in main-process code;
// patch only what this scenario triggers (legacy memory migration in SqliteStore).
const mutableApp = app as unknown as Record<string, unknown>;
if (typeof mutableApp.getAppPath !== 'function') {
  mutableApp.getAppPath = () => process.cwd();
}

export const LONGTASK_SCENARIO_ID = 'longtask-200doc';
export const LONGTASK_FROZEN_TIME = '2026-06-15T08:00:00.000Z';
export const LONGTASK_DOC_COUNT = 200;
export const LONGTASK_LIVE_UPSTREAM = 'http://172.18.5.123:8000';
export const LONGTASK_MODEL_ID = 'Qwen3.6-35B-A3B';

const PROVIDER_NAME = 'custom_ab';
const ARTIFACT_NAMES = ['summaries.md', 'index.csv', 'report.md'] as const;

const TASK_PROMPT = `工作目录下 data/ 子目录中有 200 个文本文档（doc-001.txt 到 doc-200.txt），是一份产品技术文档集的章节。请严格按以下步骤完成：

1. 用 read 工具逐个读取每个文档，每次只读一个文件，按 doc-001 到 doc-200 的顺序处理，禁止跳读、禁止批量读取。**每一条助手回复最多只能调用 1 个工具**：调用一个工具后必须等待其结果，再在下一轮回复中继续下一步，严禁在同一回复中并行发起多个工具调用。
2. 每读完一个文档，立即向 summaries.md 追加一节：二级标题为「## doc-XXX 章节名」，下面跟 2-3 句中文摘要，概括该章节的核心机制与工程建议。
3. 全部 200 个文档处理完后，生成 index.csv：每行一个文档，列为 文档编号,章节名,主题分类,一句话要点。
4. 然后写一份 report.md：综合技术分析报告，至少 1500 字，涵盖全部章节的主题归类、共性工程原则、相互之间的矛盾点与取舍建议，最后给出结论。
5. 宣布完成前必须自查：用 bash 执行 grep -c '^## doc-' summaries.md，结果必须恰好等于 200；不足 200 时必须回到第 1 步，继续处理尚未摘要的文档，直到自查通过。禁止以"剩余文档结构类似"等理由跳过。
6. 自查通过后，用一句话告诉我 summaries.md、index.csv 和 report.md 已生成。

注意：必须真实读写文件；不要在回复里直接输出全部内容代替写文件。`;

const TOPICS: Array<[string, string]> = [
  ['分布式任务调度', '任务分片、负载均衡与失败重试'],
  ['向量索引构建', '嵌入模型选择、索引分桶与召回评估'],
  ['增量数据同步', '游标管理、幂等写入与冲突消解'],
  ['权限模型设计', '角色继承、行列级权限与审计日志'],
  ['查询计划优化', '代价估计、索引选择与执行器下推'],
  ['消息可靠性投递', '去重、顺序性与死信处理'],
  ['多租户资源隔离', '配额、限速与噪声邻居治理'],
  ['配置热更新', '版本快照、灰度发布与回滚策略'],
  ['缓存一致性', '失效广播、回源保护与会话粘性'],
  ['在线模型推理', '批处理、显存管理与冷启动优化'],
  ['数据血缘追踪', '算子级血缘、影响面分析与合规审计'],
  ['日志采集管线', '边缘聚合、背压控制与采样策略'],
  ['灰度实验平台', '分流一致性、指标守护与自动止损'],
  ['文档版本管理', '快照树、三方合并与评论锚点'],
  ['实时指标聚合', '窗口语义、乱序处理与精确一次'],
  ['服务健康巡检', '探针分级、故障画像与自愈动作'],
  ['对象存储分层', '热度统计、生命周期规则与取回加速'],
  ['工作流编排引擎', '状态机持久化、补偿事务与人工节点'],
  ['知识库检索增强', ' chunk 策略、重排序与引用溯源'],
  ['告警噪声治理', '聚合规则、抑制窗口与值班路由'],
  ['跨地域容灾', '单元化部署、数据复制与切换演练'],
  ['接口契约治理', 'Schema 注册、兼容性检查与 Mock 服务'],
  ['成本归因分析', '标签体系、分摊规则与异常检测'],
  ['端侧离线同步', '操作日志压缩、冲突合并与增量校验'],
];

const VARIANTS = [
  '基础机制',
  '运维实践',
  '进阶优化',
  '故障案例',
  '性能调优',
  '安全加固',
  '成本控制',
  '迁移指南',
  '监控告警',
];

const PARAGRAPHS = [
  '本节描述{topic}的核心目标：在保证{t1}的前提下，把平均处理延迟控制在可接受范围内。实践中需要先明确边界条件，再选择与之匹配的工程手段，避免过早引入重型组件。',
  '一个常见误区是把{t1}当作单点问题处理。实际上它与上下游的写入路径、读放大和运维习惯都有耦合。建议先建立基线指标（吞吐、P99 延迟、错误率），任何改动都对照基线评估。',
  '在{t1}的实现上，业界主要有两类路线：一类是强一致优先，牺牲部分可用性换取语义简单；另一类是最终一致优先，依赖补偿与对账机制收敛状态。选型时应以业务可容忍的不一致窗口为准。',
  '容量规划方面，经验法则是按峰值流量的 2.5 倍预留资源，并为{t1}相关的元数据单独估算存储增速。元数据通常比业务数据增长更快，容易被低估。',
  '故障演练不可省略。每季度至少进行一次针对{t1}的故障注入，覆盖网络分区、磁盘写满、依赖服务降级三类场景，并把恢复时长纳入 SLO 考核。',
  '可观测性建议围绕四个信号展开：请求量、错误率、饱和度和{t1}特有的业务指标。告警阈值应基于历史分布动态调整，静态阈值在大促等场景下误报率极高。',
  '最后强调文档与值班机制。所有关于{t1}的运维手册必须随车发布，值班同学应能在不看代码的情况下完成 80% 的常见问题处置。',
];

/** Deterministic 200-document workspace content (identical on every machine). */
export function seedLongTaskWorkspace(workDir: string): void {
  fs.rmSync(workDir, { recursive: true, force: true });
  const dataDir = path.join(workDir, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  for (let index = 0; index < LONGTASK_DOC_COUNT; index++) {
    const [topic, t1] = TOPICS[index % TOPICS.length];
    const variant = VARIANTS[Math.floor(index / TOPICS.length)] ?? '综合';
    const id = String(index + 1).padStart(3, '0');
    const parts = [`# ${id} ${topic}（${variant}）`, ''];
    // Keep each doc small: the 200-doc transcript must peak far below the
    // compaction threshold so the trigger point (which is usage-accounting
    // dependent and not portable across runtimes) never fires mid-replay.
    for (let i = 0; i < 3; i++) {
      parts.push(
        PARAGRAPHS[(i + index) % PARAGRAPHS.length]
          .replaceAll('{topic}', `${topic}的${variant}`)
          .replaceAll('{t1}', t1),
      );
      parts.push('');
    }
    fs.writeFileSync(path.join(dataDir, `doc-${id}.txt`), parts.join('\n'), 'utf8');
  }
}

export interface LongTaskScenarioOptions {
  mode: 'live' | 'record' | 'replay';
  workDir: string;
  /** Required for record/replay. */
  tapePath?: string;
  /** Replay only: strict (seq+hash) by default; sequential tolerates drift. */
  tapeMatchMode?: 'strict' | 'sequential';
  /** Replay only: dump actual request bodies on strict misses. */
  tapeDebugDumpDir?: string;
  /** Replay only: dump EVERY actual request body (tape regeneration aid). */
  tapeDumpAllRequestsDir?: string;
  hardCapMs: number;
  onLifecycle?: (kind: string, detail?: string) => void;
}

export interface LongTaskScenarioSummary {
  mode: LongTaskScenarioOptions['mode'];
  durationMs: number;
  outcome: { status: string; reason?: string };
  counts: { total: number; byType: Record<string, number> };
  errors: string[];
  permissionRequestCount: number;
  workbenchTaskStatus: string | null;
  workbenchRunStatuses: string[];
  artifacts: Record<string, number | null>;
  tape: { misses: number; missReport: string; consumed: number; total: number } | null;
}

const safeSerialize = (value: unknown): string => {
  const seen = new WeakSet();
  return JSON.stringify(value, (_key, v: unknown) => {
    if (typeof v === 'string' && v.length > 4000)
      return `${v.slice(0, 4000)}…[truncated ${v.length}]`;
    if (v && typeof v === 'object') {
      if (seen.has(v)) return '[circular]';
      seen.add(v);
    }
    return v;
  });
};

export async function runLongTaskScenario(
  options: LongTaskScenarioOptions,
): Promise<LongTaskScenarioSummary> {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(LONGTASK_FROZEN_TIME));
  const startedAt = Date.now();
  const monotonicStart = performance.now();
  const emit = (kind: string, detail?: string) => {
    const elapsed = ((performance.now() - monotonicStart) / 1000).toFixed(1);
    console.log(`[${elapsed}s] ${kind}${detail ? ` ${detail}` : ''}`);
    options.onLifecycle?.(kind, detail);
  };

  let tapeServer: PiProviderTapeServer | null = null;
  let store: SqliteStore | null = null;
  let adapter: PiRuntimeAdapter | null = null;
  try {
    if (options.mode !== 'live') {
      if (!options.tapePath) throw new Error(`${options.mode} mode requires tapePath`);
      tapeServer = await PiProviderTapeServer.start({
        mode: options.mode,
        scenario: LONGTASK_SCENARIO_ID,
        workDir: options.workDir,
        upstream: options.mode === 'record' ? LONGTASK_LIVE_UPSTREAM : undefined,
        tapePath: options.tapePath,
        matchMode: options.tapeMatchMode ?? 'strict',
        debugDumpDir: options.tapeDebugDumpDir,
        dumpAllRequestsDir: options.tapeDumpAllRequestsDir,
      });
      emit('tapeServer', `${options.mode} ${tapeServer.baseUrl}`);
    }
    const providerBaseUrl =
      options.mode === 'live' ? `${LONGTASK_LIVE_UPSTREAM}/v1` : tapeServer!.baseUrl;

    seedLongTaskWorkspace(options.workDir);

    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-longtask-store-'));
    store = await SqliteStore.create(userData);
    store.set('app_config', {
      api: { key: '', baseUrl: '' },
      model: {
        availableModels: [{ id: LONGTASK_MODEL_ID, name: LONGTASK_MODEL_ID }],
        defaultModel: LONGTASK_MODEL_ID,
        defaultModelProvider: PROVIDER_NAME,
      },
      providers: {
        [PROVIDER_NAME]: {
          enabled: true,
          apiKey: '',
          baseUrl: providerBaseUrl,
          apiFormat: 'openai',
          models: [
            {
              id: LONGTASK_MODEL_ID,
              name: LONGTASK_MODEL_ID,
              supportsImage: false,
              capabilities: { imageInput: ModelCapabilityStatus.Unsupported },
              // The scenario is sized so total context peaks far below the
              // compaction threshold (window minus reserve): the threshold
              // trigger depends on provider usage accounting that is not
              // portable across runtimes, and a mid-run compaction would
              // slide off the tape's request sequence.
              contextWindow: 262_144,
              maxTokens: 4096,
            },
          ],
        },
      },
      theme: 'system',
      language: 'zh',
      useSystemProxy: false,
      app: { port: 0, isDevelopment: false },
    });
    setStoreGetter(() => store);

    const db = store.getDatabase();
    initializeWorkbenchTaskSchema(db);
    const coworkStore = new CoworkStore(db);
    const workbenchTaskService = new WorkbenchTaskService(db);

    adapter = new PiRuntimeAdapter();
    adapter.setCoworkStore(coworkStore);
    adapter.setWorkbenchTaskService(workbenchTaskService);

    const counts: LongTaskScenarioSummary['counts'] = { total: 0, byType: {} };
    const errors: string[] = [];
    let permissionRequestCount = 0;
    adapter.on('executionEvent', (_sessionId, event) => {
      counts.total += 1;
      counts.byType[event.type] = (counts.byType[event.type] ?? 0) + 1;
      if (event.type === 'tool_execution_start') {
        const name = (event as { toolName?: string }).toolName ?? '';
        emit('tool', `${counts.byType['tool_execution_start']} ${name}`);
      }
    });
    adapter.on('permissionRequest', (_sessionId, request) => {
      permissionRequestCount += 1;
      // Synchronous auto-approval on purpose: exercises the in-process
      // approval path that CI users of AllowAll-adjacent flows rely on.
      adapter?.respondToPermission(request.requestId, { behavior: 'allow' });
    });
    adapter.on('error', (_sessionId, error) => {
      const detail = safeSerialize(error);
      errors.push(detail);
      emit('error', detail.slice(0, 300));
    });

    const systemPrompt = composeCoworkSystemPrompt({
      basePrompt: '',
      expertSnapshots: [],
      language: 'zh',
    });
    // Session identity must be byte-identical across record and replay: the
    // title and id enter the workbench contract context of later requests.
    const session = coworkStore.createSession(
      'ab-longtask',
      options.workDir,
      systemPrompt,
      CoworkExecutionMode.Local,
      [],
      'main',
      '',
      'work',
      'ab-longtask-session',
    );

    const outcome: LongTaskScenarioSummary['outcome'] = await new Promise(resolve => {
      const capTimer = setTimeout(() => {
        resolve({ status: 'timeout', reason: `hard cap ${options.hardCapMs / 60000}min reached` });
      }, options.hardCapMs);
      adapter!.on('complete', completedSessionId => {
        if (completedSessionId !== session.id) return;
        clearTimeout(capTimer);
        resolve({ status: 'complete' });
      });
      adapter!.on('error', erroredSessionId => {
        if (erroredSessionId !== session.id) return;
        // Mid-run errors can be recovered by the stall auto-resume; only
        // settle as failed once the session stays down through a grace window.
        setTimeout(() => {
          if (!adapter!.isSessionRunning(session.id)) {
            clearTimeout(capTimer);
            resolve({ status: 'error', reason: 'session stopped after an error' });
          }
        }, 2000);
      });
      adapter!
        .startSession(session.id, TASK_PROMPT, {
          skipInitialUserMessage: true,
          systemPrompt,
          workspaceRoot: options.workDir,
          confirmationMode: 'modal',
          sessionMode: 'work',
          approvalMode: WorkbenchApprovalMode.Ask,
        })
        .catch((error: unknown) => {
          clearTimeout(capTimer);
          resolve({ status: 'start_rejected', reason: String(error) });
        });
    });
    emit('outcome', safeSerialize(outcome));

    const detail = workbenchTaskService.getCurrent(session.id);
    const artifacts = Object.fromEntries(
      ARTIFACT_NAMES.map(name => [
        name,
        fs.existsSync(path.join(options.workDir, name))
          ? fs.statSync(path.join(options.workDir, name)).size
          : null,
      ]),
    );
    return {
      mode: options.mode,
      durationMs: Date.now() - startedAt,
      outcome,
      counts,
      errors,
      permissionRequestCount,
      workbenchTaskStatus: detail?.task.status ?? null,
      workbenchRunStatuses: detail?.runs.map(run => run.status) ?? [],
      artifacts,
      tape: tapeServer
        ? {
            misses: tapeServer.missCount,
            missReport: tapeServer.describeMisses(),
            consumed: tapeServer.consumedEntries,
            total: tapeServer.totalEntries,
          }
        : null,
    };
  } finally {
    if (adapter) await adapter.stopAllSessions();
    await stopPiOpenAICompatProxyForTests();
    if (tapeServer) await tapeServer.close();
    if (store) store.close();
    vi.useRealTimers();
  }
}
