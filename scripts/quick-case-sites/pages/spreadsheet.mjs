import { bars, esc, list, metricHtml } from '../html.mjs';
import { pageShell } from '../shell.mjs';

export function spreadsheet(c, index) {
  const schemas = {
    'image-to-excel': {
      names: ['发票号', '供应商', '含税金额', '识别置信度', '审核状态'],
      rows: [
        ['INV-2408', '青禾办公', '¥ 2,480.00', '98%', '待复核'],
        ['INV-2411', '远山物流', '¥ 860.00', '72%', '金额低置信'],
        ['INV-2416', '木棉科技', '¥ 12,600.00', '96%', '重复项检查'],
      ],
    },
    'excel-summary': {
      names: ['渠道', '收入指数', '折扣率', '毛利率', '判断'],
      rows: [
        ['直营', '128', '6.2%', '42.1%', '稳健'],
        ['电商', '146', '18.4%', '27.8%', '促销侵蚀'],
        ['分销', '119', '9.1%', '36.5%', '观察'],
      ],
    },
    'multi-excel-merge': {
      names: ['来源文件', 'SKU 行数', '缺失编码', '重复项', '合并结果'],
      rows: [
        ['华东仓.xlsx', '1,248', '3', '12', '已合并'],
        ['华南仓.xlsx', '986', '0', '8', '已合并'],
        ['门店盘点.csv', '412', '17', '0', '需映射'],
      ],
    },
    'excel-reconcile': {
      names: ['银行流水', '订单号', '金额差异', '匹配依据', '状态'],
      rows: [
        ['B-0821', 'ORD-7182', '¥ 0.00', '金额 + 日期', '已匹配'],
        ['B-0824', 'ORD-7199', '¥ 12.00', '近似金额', '人工确认'],
        ['B-0828', '—', '—', '无订单引用', '待查明'],
      ],
    },
    'excel-pivot': {
      names: ['获客渠道', '首月用户', '第 4 周留存', '样本口径', '信号'],
      rows: [
        ['内容自然流量', '420', '31%', '首次访问', '高质量'],
        ['付费投放', '890', '14%', '去重用户', '量大质弱'],
        ['合作推荐', '165', '38%', '有效注册', '可扩展'],
      ],
    },
    'excel-anomaly': {
      names: ['设备 / 时段', '基线 kWh', '实测 kWh', '偏差', '巡检线索'],
      rows: [
        ['冷机 A · 02:00', '18.4', '31.7', '+72%', '阀门状态'],
        ['冷机 B · 02:00', '16.9', '17.3', '+2%', '正常范围'],
        ['泵组 C · 03:00', '8.2', '12.6', '+54%', '待现场核验'],
      ],
    },
    'excel-forecast': {
      names: ['SKU / 周末', '预测需求', '可售库存', '损耗风险', '建议动作'],
      rows: [
        ['草莓 250g', '84 盒', '61 盒', '中', '小批补货'],
        ['鲜奶 1L', '112 瓶', '130 瓶', '低', '维持'],
        ['切片蛋糕', '46 份', '28 份', '高', '分两次备货'],
      ],
    },
    'excel-carbon': {
      names: ['采购品类', '年度金额', '排放因子版本', '数据质量', '优先动作'],
      rows: [
        ['铝型材', '¥ 186 万', 'EF-2025 v2', 'C', '索取供应商实测'],
        ['物流运输', '¥ 92 万', 'GLEC 3.0', 'B', '补齐路线距离'],
        ['办公设备', '¥ 48 万', 'EF-2024 v1', 'D', '核对物料映射'],
      ],
    },
    'excel-staffing': {
      names: ['护理组', '夜班数 / 4 周', '连续班次', '休息间隔', '排班提示'],
      rows: [
        ['急诊 A', '6', '3', '12 h', '覆盖且均衡'],
        ['内科 B', '9', '4', '11 h', '复核连续夜班'],
        ['儿科 C', '3', '2', '14 h', '可承担替班'],
      ],
    },
    'excel-energy': {
      names: ['账期', '峰时 kWh', '平时 kWh', '谷时 kWh', '估算费用'],
      rows: [
        ['6 月', '182', '244', '309', '¥ 612'],
        ['7 月', '236', '271', '288', '¥ 738'],
        ['8 月', '229', '263', '342', '¥ 701'],
      ],
    },
    'excel-clinic': {
      names: ['科室 / 时段', '样本量', 'P50 等候', 'P90 等候', '爽约率'],
      rows: [
        ['全科 · 上午', '218', '18 min', '54 min', '7.2%'],
        ['儿科 · 傍晚', '164', '24 min', '81 min', '11.8%'],
        ['皮肤科 · 下午', '132', '12 min', '38 min', '4.6%'],
      ],
    },
  };
  const schema = schemas[c.id] ?? {
    names: ['项目', '当前值', '目标 / 基准', '变化', '下一步'],
    rows: c.steps.map((step, i) => [
      step,
      c.metrics[i % 3][0],
      c.metrics[(i + 1) % 3][0],
      i === 1 ? '−2.8%' : `+${i + 2}.4%`,
      ['复核口径', '拆分维度', '负责人确认'][i],
    ]),
  };
  const names = schema.names;
  const rows = schema.rows
    .map(
      (row, i) =>
        `<tr>${row.map((cell, j) => `<td>${j === 0 ? `<span class="status s${i}"></span>` : ''}${esc(cell)}</td>`).join('')}</tr>`,
    )
    .join('');
  return pageShell(
    c,
    `<div class="app"><aside class="rail"><div class="rail-brand">Y / WORKS</div><span class="eyebrow">WORKBOOK</span><a class="selected">▦　经营视图</a><a>▤　明细记录</a><a>⌘　校验规则</a><div class="rail-bottom">演示环境<br>最后更新 09:41</div></aside><main class="work"><header class="worktop"><span>${esc(c.label)}　/　2026 Q3</span><div class="chips"><button class="chip filter" aria-pressed="true">全部</button><button class="chip filter">直营</button><button class="chip filter">渠道</button><button class="button outline" id="export">导出视图 ↓</button></div></header><section class="sheethead"><div><span class="eyebrow">DECISION WORKSPACE / 0${index + 1}</span><h1>${esc(c.title)}</h1><p>${esc(c.lead)}</p></div><span class="demo">● 演示数据</span></section><div class="kpis">${metricHtml(c.metrics)}</div><section class="analysis"><div class="panel"><div class="section-head"><div><span class="eyebrow">TREND / BY PERIOD</span><h2>趋势与基准</h2></div><button class="chip switch" aria-pressed="true">金额</button></div>${bars(c.chart)}</div><div class="panel"><span class="eyebrow">READOUT</span><h2>先处理结构，再看总量</h2><p class="finding">${esc(c.insight)}</p>${list(c.steps, 'steps')}</div></section><section class="gridtable"><div class="table-head"><div><span class="eyebrow">DETAIL / FILTERABLE</span><h2>需要跟进的项目</h2></div><span>4 条记录　·　公式口径可追溯</span></div><div class="table-scroll"><table><thead><tr>${names.map(n => `<th>${n}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div></section><footer>样例工作簿 · 汇总应由明细公式计算 · 需导入真实数据后复核</footer></main></div>`,
    `.app{min-height:100vh;display:grid;grid-template-columns:205px 1fr}.rail{padding:24px 18px;background:#202b27;color:#dae1d8;display:flex;flex-direction:column;gap:12px}.rail-brand{font-size:12px;letter-spacing:.12em;margin-bottom:52px}.rail .eyebrow{color:#8ca299}.rail a{padding:10px 8px;color:#9eada4;font-size:12px}.rail a.selected{background:#ffffff12;color:#f0f3e9;border-left:2px solid var(--accent)}.rail-bottom{margin-top:auto;color:#83948a;font:10px/1.8 ui-monospace}.work{padding:0 5vw 22px;min-width:0}.worktop{height:62px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #deded7;color:#68736b;font-size:11px}.worktop .chips{align-items:center}.sheethead{padding:31px 0 23px;display:flex;justify-content:space-between;align-items:start}.sheethead h1{font-size:clamp(27px,3vw,42px);line-height:1.12;letter-spacing:-.045em;margin:9px 0}.sheethead p{color:#758078;margin:0}.demo{font:10px ui-monospace;color:#b58149}.kpis{background:#fff;border:1px solid #e1e4dc;display:grid;grid-template-columns:repeat(3,1fr);margin-bottom:18px}.kpis .metric{padding:14px 18px}.analysis{display:grid;grid-template-columns:1fr 1fr;gap:15px}.analysis .panel{min-height:254px}.analysis h2,.gridtable h2{font-size:17px;margin:4px 0 12px}.finding{font:18px/1.45 Georgia,"Songti SC",serif;color:#34443a;max-width:28ch}.steps{padding-left:17px;color:#6d776f;font-size:12px}.steps li{padding:4px 0}.gridtable{margin-top:16px;background:#fff;border:1px solid #e1e4dc}.table-head{padding:17px 18px 9px;display:flex;justify-content:space-between;align-items:center}.table-head>span{font-size:10px;color:#89928b}.table-scroll{overflow:auto}table{width:100%;border-collapse:collapse;font-size:11px}th{text-align:left;color:#889189;font-weight:500;background:#f6f7f3}td,th{padding:11px 14px;border-top:1px solid #eceee9;white-space:nowrap}.status{display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--accent);margin-right:9px}.s1{background:#d39e53}.s2{background:#bb7764}.delta{font-family:ui-monospace;color:#477d69}.work footer{padding:16px 0;color:#879089;font-size:10px}.filter[aria-pressed=true],.switch[aria-pressed=true]{background:#29372f;color:#fff}.bar-col i{background:var(--accent)}@media(max-width:760px){.app{grid-template-columns:1fr}.rail{display:none}.work{padding:0 18px 20px}.worktop{height:auto;min-height:58px;gap:10px;flex-wrap:wrap;padding:10px 0}.worktop .chip{padding:6px 8px}.sheethead{gap:10px;flex-direction:column}.analysis{grid-template-columns:1fr}.analysis .panel{min-height:0}.kpis{grid-template-columns:1fr}.kpis .metric{border-bottom:1px solid #daddd6}.table-head{align-items:start;gap:8px;flex-direction:column}}`,
    `document.querySelectorAll('.filter').forEach(b=>b.onclick=()=>{document.querySelectorAll('.filter').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));document.querySelector('.table-head>span').textContent='筛选：'+b.textContent+'　·　演示数据'});document.querySelector('.switch').onclick=e=>{const b=e.currentTarget;b.textContent=b.textContent==='金额'?'完成率':'金额';document.querySelector('.finding').textContent='视图已切换：'+b.textContent+' · '+${JSON.stringify(c.insight)}};document.querySelector('#export').onclick=()=>window.print();`,
  );
}
