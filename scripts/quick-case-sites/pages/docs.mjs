import { esc, metricHtml } from '../html.mjs';
import { pageShell } from '../shell.mjs';

export function docs(c, index) {
  const tailored = {
    'docs-meeting': [
      [
        'DECISIONS',
        '已确认的供应商接入范围',
        '只开放只读工单查询；写入能力进入下一轮安全评审。',
        '决策依据',
        '权限范围与首期验收能力一致。',
      ],
      [
        'OPEN QUESTIONS',
        '待补充的接入条件',
        '供应商提供数据留存说明；安全团队确认密钥轮换周期。',
        '阻塞方',
        '供应商 / 安全负责人',
      ],
      [
        'ACTION REGISTER',
        '行动项与截止时间',
        '接口样例 — 林然 — 10 月 02 日；威胁模型 — 周珂 — 10 月 04 日。',
        '下次检查',
        '接入评审会 · 10 月 06 日',
      ],
    ],
    'docs-report': [
      [
        'IMPACT',
        '事件影响范围',
        '支付回调延迟 42 分钟；受影响订单进入待对账队列，未发现重复扣款证据。',
        '检测信号',
        '回调队列积压告警',
      ],
      [
        'TIMELINE',
        '关键时间线',
        '09:14 队列延迟升高 → 09:22 告警触发 → 09:37 限流缓解 → 09:56 恢复。',
        '系统条件',
        '重试洪峰与单队列竞争',
      ],
      [
        'FOLLOW UP',
        '修复与验证',
        '增加分区隔离；用回放流量验证积压恢复时间，并检查重复投递幂等性。',
        '复核窗口',
        '发布后 7 天观察',
      ],
    ],
    'docs-summary': [
      [
        'WHAT CHANGED',
        '经营信号',
        '收入指数上升，但促销渠道毛利率下滑；两个新区域仍处于小样本阶段。',
        '可信边界',
        '指数为演示口径',
      ],
      [
        'DECISIONS',
        '需要拍板的事项',
        '是否暂停低毛利折扣；是否将新增预算投入复购实验而非继续扩量。',
        '建议选项',
        '先做两周分组试验',
      ],
      [
        'RISKS',
        '风险与触发线',
        '若毛利率连续两周低于 30%，停止扩量并复核客群质量。',
        '决策请求',
        '确认试验预算与负责人',
      ],
    ],
    'docs-notice': [
      [
        'WHEN',
        '维护窗口',
        '10 月 08 日 01:00–01:30（北京时间）；若提前完成将通过状态页公告。',
        '预约任务',
        '本窗口不安排批量导入',
      ],
      [
        'WHAT CHANGES',
        '用户可见影响',
        '数据导入和历史记录导出暂不可用；已提交任务保留并在恢复后继续。',
        '无需操作',
        '无需重复提交任务',
      ],
      [
        'IF DELAYED',
        '回退与支持',
        '若 01:30 未恢复，关闭新导入入口并回退版本；状态页每 15 分钟更新。',
        '支持入口',
        '控制台帮助中心',
      ],
    ],
    'docs-api': [
      [
        'QUICK START',
        '接收第一条 webhook',
        '创建订阅 → 复制签名密钥 → 启动本地接收端 → 点击发送测试事件。',
        '签名头',
        'X-Hook-Signature: sha256=…',
      ],
      [
        'VERIFY',
        '验证签名并防重放',
        '对原始请求体计算 HMAC-SHA256；时间戳偏差超过 5 分钟时拒绝请求。',
        '幂等键',
        'event_id + endpoint_id',
      ],
      [
        'RETRY',
        '返回码与重试策略',
        '2xx 确认；429 按 Retry-After 重试；5xx 指数退避，最多 8 次。',
        '安全提示',
        '密钥仅存服务端',
      ],
    ],
    'docs-polish': [
      [
        'VOICE',
        '先说用户能做什么',
        '原：发生未知错误。改：暂时无法保存更改，请复制内容后重试。',
        '规则',
        '给动作，再给原因',
      ],
      [
        'STATES',
        '空状态与权限提示',
        '空：还没有保存的报告。权限：需要允许访问项目文件，才能生成摘要。',
        '禁用表达',
        '避免“操作失败，请联系管理员”',
      ],
      [
        'REVIEW',
        '发布前检查',
        '每条提示都应说明当前状态、下一步动作和数据是否已保存。',
        '验收方式',
        '用首次使用者朗读测试',
      ],
    ],
    'docs-sop': [
      [
        'CASH & HANDOFF',
        '收银与交接',
        '核对现金抽屉、退款记录和当日订单；两人签名后封存。',
        '复核点',
        '账面与实点差异为 ¥0',
      ],
      [
        'EQUIPMENT',
        '设备清洁与断电',
        '清洁磨豆机与蒸汽棒；反冲洗咖啡机；记录冷藏柜温度后关非必要电源。',
        '异常处理',
        '温度超 5°C 联系值班经理',
      ],
      [
        'SECURE',
        '门店安全检查',
        '检查燃气阀、后门、窗锁与钥匙柜；上传闭店照片并交接未完成事项。',
        '完成判定',
        '店长完成最终签核',
      ],
    ],
    'docs-board': [
      [
        'RECOMMENDATION',
        '分阶段进入，不一次性铺开',
        '先在胡志明市建立经销试点；暂缓自建服务网络，等待售后成本证据。',
        '替代方案',
        '仅做跨境电商验证',
      ],
      [
        'COMMITMENT',
        '资源和阶段门',
        '第一阶段投入 ¥180 万；达到 3 家稳定渠道、退货率低于 5% 后再申请扩区。',
        '止损条件',
        '两个季度未达到渠道门槛',
      ],
      [
        'BOARD ACTION',
        '本次需要批准',
        '批准市场验证预算与一名本地负责人；产品本地化和长期库存另行审批。',
        '未验证假设',
        '渠道转化与售后成本',
      ],
    ],
    'docs-grant': [
      [
        'NEED & BASELINE',
        '社区缺少稳定的课后空间',
        '基线访谈显示照护缺口集中在工作日 16:00 后；需以正式调查核实比例。',
        '目标人群',
        '12–16 岁青少年及照护者',
      ],
      [
        'CHANGE PATH',
        '活动如何带来结果',
        '每周开放工作坊 → 稳定参与与同伴支持 → 提升课后安全感和归属感。',
        '结果指标',
        '连续参与率、匿名安全感量表',
      ],
      [
        'BUDGET & LEARNING',
        '预算与评估安排',
        '场地 ¥12 万、导师 ¥16 万、评估 ¥4 万；季度复盘并公布未达标原因。',
        '延续条件',
        '至少两家社区伙伴共担资源',
      ],
    ],
    'docs-research-protocol': [
      [
        'SITE START-UP',
        '中心启用前检查',
        '完成伦理批件、人员培训、设备校准和试录入；未签署授权书不得招募。',
        '启动判定',
        '中心清单全部签核',
      ],
      [
        'PARTICIPANT FLOW',
        '招募到随访的统一步骤',
        '筛选编号 → 独立说明与同意 → 基线测量 → 访视提醒 → 退出记录。',
        '疑问升级',
        '24 小时内报协调中心',
      ],
      [
        'DEVIATIONS',
        '偏离和数据查询处理',
        '保留原始记录；偏离按影响分级；数据查询由中心在 2 个工作日内回应。',
        '审计留痕',
        '版本、操作者、时间戳',
      ],
    ],
    'docs-incident-comms': [
      [
        'CONFIRMED FACTS',
        '目前已确认的情况',
        '10 月 02 日发现日志配置可能暴露部分账户标识；正在核实访问范围与数据类别。',
        '对外承诺',
        '每两小时更新已核实信息',
      ],
      [
        'USER ACTION',
        '用户现在可以做什么',
        '检查账户近期活动；如发现异常，撤销访问令牌并联系安全支持。',
        '避免表达',
        '不推测人数，不称“无影响”',
      ],
      [
        'REVIEW & RELEASE',
        '发布前联合校验',
        '安全确认影响范围，法务复核通知义务，客服演练答疑；每次更新记录版本。',
        '下一更新时间',
        '待事件负责人确认',
      ],
    ],
  };
  const blocks =
    c.id in tailored
      ? tailored[c.id]
          .map(
            (row, i) =>
              `<section class="docblock"><div class="blocknum">0${i + 1}</div><div><span class="eyebrow">${row[0]}</span><h2>${row[1]}</h2><p>${row[2]}</p><div class="lineitem"><b>${row[3]}</b><span>${row[4]}</span></div></div></section>`,
          )
          .join('')
      : c.steps
          .map(
            (s, i) =>
              `<section class="docblock"><div class="blocknum">0${i + 1}</div><div><span class="eyebrow">${['CONTEXT', 'DECISION', 'FOLLOW THROUGH'][i]}</span><h2>${esc(s)}</h2><p>${esc(c.lead)} 这部分需要负责人、完成条件和复核时间，避免将建议误作已批准决策。</p><div class="lineitem"><b>${['背景与现状', '明确的选择', '可检验的完成标准'][i]}</b><span>${esc(c.insight)}</span></div><div class="lineitem"><b>责任 / 时间</b><span>待业务方确认　·　建议在下一次评审前复核</span></div></div></section>`,
          )
          .join('');
  return pageShell(
    c,
    `<header class="docbar"><div class="shell"><a href="#top" class="wordmark">FORM / ${String(index + 1).padStart(2, '0')}</a><span>${esc(c.label)}　·　工作稿 v1.2</span><div><button class="tool" id="outline">目录</button><button class="tool" onclick="window.print()">打印 / PDF</button></div></div></header><main id="top" class="doc shell"><aside id="toc"><span class="eyebrow">DOCUMENT MAP</span><a href="#summary">摘要</a>${c.steps.map((s, i) => `<a href="#part${i}">0${i + 1}　${esc(s)}</a>`).join('')}<a href="#decision">待确认项</a><div class="docstamp">内部讨论稿<br>更新于 2026.09</div></aside><article><header class="doccover"><span class="eyebrow">${esc(c.label)} / DECISION PAPER</span><h1>${esc(c.title)}</h1><p>${esc(c.lead)}</p><div class="covermeta"><span>适用对象　项目负责人 / 协作团队</span><span>状态　待评审</span><span>版本　1.2</span></div></header><section class="summary" id="summary"><span class="eyebrow">EXECUTIVE SUMMARY</span><h2>先确认要解决的决定</h2><p>${esc(c.insight)}</p><div class="metrics">${metricHtml(c.metrics)}</div></section>${blocks}<section class="decision" id="decision"><span class="eyebrow">OPEN ITEMS / BEFORE APPROVAL</span><h2>这些问题仍需确认</h2><div class="questions">${['本方案的最终负责人是谁？', '完成标准与复核日期是否可量化？', '哪些假设需要先用真实数据验证？'].map((x, i) => `<label><input type="checkbox"> <span><b>0${i + 1}</b>${x}</span></label>`).join('')}</div><p class="note">${esc(c.insight)} 内容为示例草稿，勾选状态只保留在当前页面。</p></section><footer class="docfoot"><span>知远工作样稿 · 依据真实项目补充事实、责任人与审批记录</span><a href="#top">返回顶部 ↑</a></footer></article></main>`,
    `.docbar{height:58px;border-bottom:1px solid #e1ddd5;background:#faf9f5}.docbar .shell{height:100%;display:flex;align-items:center;justify-content:space-between;color:#827a70;font-size:10px}.wordmark{font:12px ui-monospace;letter-spacing:.1em;color:#302d28}.tool{border:0;background:none;padding:7px 10px;color:#685f55;font-size:10px}.tool:hover{background:#eeeae2}.doc{display:grid;grid-template-columns:170px 1fr;gap:8vw;padding-top:42px}.doc aside{position:sticky;align-self:start;top:20px;display:flex;flex-direction:column;gap:13px}.doc aside>a{font-size:11px;color:#777166;padding:5px 0;border-bottom:1px solid #ebe7df}.docstamp{margin-top:28px;border-top:1px solid #ded8ce;padding-top:12px;color:#9a9185;font:9px/1.8 ui-monospace}.doccover{padding:24px 0 21px;border-bottom:1px solid #ded9d0}.doccover h1{font:500 clamp(36px,5vw,58px)/1.1 Georgia,"Songti SC",serif;letter-spacing:-.055em;max-width:19ch;margin:18px 0 13px}.doccover>p{font-size:15px;color:#746e65;max-width:58ch}.covermeta{display:flex;gap:22px;flex-wrap:wrap;padding-top:15px;margin-top:24px;border-top:1px solid #e7e2d9;color:#8f877b;font-size:9px}.summary{padding:25px 0;border-bottom:1px solid #ded9d0}.summary h2,.decision h2{font:500 24px Georgia,"Songti SC",serif;margin:7px 0}.summary>p{color:#5d675f;max-width:60ch}.summary .metrics{background:#fff;border:1px solid #e6e2da}.summary .metric{padding:12px 14px}.summary .metric strong{font-size:18px}.docblock{display:grid;grid-template-columns:42px 1fr;gap:18px;padding:28px 0;border-bottom:1px solid #ded9d0}.blocknum{font:12px ui-monospace;color:var(--accent);padding-top:4px}.docblock h2{font:500 22px Georgia,"Songti SC",serif;margin:7px 0}.docblock p{font-size:12px;color:#727066;max-width:62ch}.lineitem{display:grid;grid-template-columns:130px 1fr;gap:12px;padding:10px 0;border-top:1px solid #e8e4dc;font-size:11px}.lineitem b{font-weight:550;color:#55534d}.lineitem span{color:#77746d}.decision{padding:28px 0}.questions{margin:18px 0}.questions label{display:flex;align-items:center;gap:12px;border-top:1px solid #e5e1d9;padding:13px 3px;font-size:12px}.questions label:last-child{border-bottom:1px solid #e5e1d9}.questions input{accent-color:var(--accent)}.questions b{font:10px ui-monospace;color:#aa947d;margin-right:14px}.note{font-size:10px;color:#808078}.docfoot{border-top:1px solid #ded9d0;padding:17px 0 28px;display:flex;justify-content:space-between;color:#898279;font-size:9px}.docfoot a{color:#615d53}@media(max-width:760px){.doc{grid-template-columns:1fr;gap:20px;padding-top:25px}.doc aside{position:static;display:grid;grid-template-columns:1fr 1fr;gap:8px}.doc aside .eyebrow,.docstamp{grid-column:1/-1}.docbar .shell{gap:5px}.docbar .shell>span{display:none}.docblock{grid-template-columns:27px 1fr;gap:8px}.lineitem{grid-template-columns:100px 1fr}.covermeta{gap:8px 15px}}`,
    `document.querySelector('#outline').onclick=()=>{const t=document.querySelector('#toc');t.hidden=!t.hidden};`,
  );
}
