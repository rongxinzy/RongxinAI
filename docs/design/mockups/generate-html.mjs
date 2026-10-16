#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

const dir = path.dirname(new URL(import.meta.url).pathname);

const BW_4090M = 576;
const ETA = 0.6;

function speedFromFileGb(fileGb, bw = BW_4090M) {
  const center = (bw * ETA) / fileGb;
  const low = Math.round(center * 0.85);
  const high = Math.round(center * 1.15);
  const chars = Math.round(center);
  let tier = '偏慢';
  if (center >= 55) tier = '生成很快';
  else if (center >= 28) tier = '正常';
  return { center, low, high, chars, tier };
}

const s8 = speedFromFileGb(5.0);
const s14 = speedFromFileGb(8.6);
const s4 = speedFromFileGb(2.6);

function css(theme) {
  const light = theme === 'light';
  const bg = light ? '#EEEFF2' : '#0C0F14';
  const surface = light ? '#FFFFFF' : '#151922';
  const border = light ? '#DDE1E8' : '#252A35';
  const muted = light ? '#64748B' : '#94A3B8';
  return `
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: Inter, -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif; font-size: 13px; line-height: 1.45; color: ${light ? '#0F172A' : '#E2E8F0'}; background: ${bg}; }
.app { max-width: 1120px; margin: 0 auto; padding: 10px 16px 28px; }
.row-bar { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.row-bar h1 { font-size: 17px; font-weight: 600; flex: 1; }
.profile-line { padding: 10px 12px; margin-bottom: 8px; background: ${surface}; border: 1px solid ${border}; border-radius: 8px; font-size: 13px; display: flex; justify-content: space-between; align-items: center; }
.profile-line a { font-size: 12px; color: ${light ? '#2563EB' : '#60A5FA'}; text-decoration: none; }
.tabs { display: flex; gap: 4px; margin-bottom: 8px; flex-wrap: wrap; }
.tab { font-size: 12px; padding: 4px 10px; border-radius: 6px; border: 1px solid ${border}; background: ${surface}; color: ${muted}; }
.tab.on { background: ${light ? '#EFF6FF' : '#1E3A5F'}; color: ${light ? '#1D4ED8' : '#93C5FD'}; border-color: ${light ? '#93C5FD' : '#2563EB'}; }
.section { font-size: 11px; font-weight: 600; color: ${muted}; margin: 10px 0 6px; text-transform: uppercase; letter-spacing: 0.04em; }
.pick-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin-bottom: 8px; }
.pick { background: ${surface}; border: 1px solid ${border}; border-radius: 8px; padding: 8px 10px; font-size: 12px; }
.pick strong { display: block; font-size: 12px; margin-bottom: 4px; }
.pick .reason { color: ${muted}; font-size: 11px; line-height: 1.35; min-height: 2.6em; }
.list { background: ${surface}; border: 1px solid ${border}; border-radius: 8px; overflow: hidden; }
.lrow { display: grid; grid-template-columns: 1fr auto; gap: 8px; padding: 9px 12px; border-bottom: 1px solid ${border}; align-items: center; font-size: 12px; }
.lrow:last-child { border-bottom: none; }
.badge { display: inline-block; font-size: 10px; font-weight: 600; padding: 2px 6px; border-radius: 4px; margin-right: 4px; }
.b-ok { background: ${light ? '#DCFCE7' : '#14532D'}; color: ${light ? '#166534' : '#86EFAC'}; }
.b-mid { background: ${light ? '#FEF9C3' : '#713F12'}; color: ${light ? '#854D0E' : '#FDE047'}; }
.b-no { background: ${light ? '#FEE2E2' : '#7F1D1D'}; color: ${light ? '#B91C1C' : '#FCA5A5'}; }
.b-agent { background: ${light ? '#E0E7FF' : '#312E81'}; color: ${light ? '#3730A3' : '#C7D2FE'}; }
.b-chat { background: ${light ? '#F1F5F9' : '#334155'}; color: ${muted}; }
.btn { height: 30px; padding: 0 14px; border-radius: 6px; font-size: 12px; cursor: pointer; border: 1px solid ${border}; background: ${surface}; color: inherit; }
.btn-main { background: ${light ? '#2563EB' : '#3B82F6'}; color: #fff; border: none; }
.panel { background: ${surface}; border: 1px solid ${border}; border-radius: 8px; padding: 12px 14px; margin-bottom: 8px; }
.hero h2 { font-size: 16px; margin-bottom: 8px; }
.hero .lead { margin-bottom: 8px; font-size: 13px; }
.hero .speed { font-size: 15px; font-weight: 600; margin-bottom: 4px; }
.hero .license { font-size: 11px; color: ${muted}; }
details { border: 1px solid ${border}; border-radius: 8px; padding: 0 12px 10px; background: ${surface}; margin-bottom: 8px; font-size: 12px; }
summary { padding: 10px 0; cursor: pointer; color: ${muted}; font-weight: 600; list-style: none; }
summary::-webkit-details-marker { display: none; }
table { width: 100%; border-collapse: collapse; font-size: 11px; margin-top: 6px; }
td, th { padding: 6px 8px; border-bottom: 1px solid ${border}; text-align: left; }
th { color: ${muted}; font-weight: 500; }
.banner { padding: 10px 12px; border-radius: 8px; margin-bottom: 8px; font-size: 12px; display: flex; justify-content: space-between; align-items: center; gap: 10px; }
.banner-info { background: ${light ? '#EFF6FF' : '#1E3A5F'}; border: 1px solid ${light ? '#BFDBFE' : '#2563EB'}; }
.banner-warn { background: ${light ? '#FFFBEB' : '#422006'}; border: 1px solid ${light ? '#FDE68A' : '#CA8A04'}; }
.progress { height: 6px; background: ${light ? '#E2E8F0' : '#334155'}; border-radius: 3px; margin-top: 6px; }
.progress i { display: block; height: 100%; width: 62%; background: #2563EB; border-radius: 3px; }
.mock-label { position: fixed; top: 6px; right: 8px; font-size: 10px; color: ${muted}; }
.empty { text-align: center; padding: 32px 16px; }
`;
}

function wrap(theme, title, body) {
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"/><title>${title}</title><style>${css(theme)}</style></head>
<body><span class="mock-label">rev3 · ${theme === 'light' ? '浅' : '深'} · dual-4090-16g</span><div class="app">${body}</div></body></html>`;
}

const profileSimple = `
<div class="profile-line">
  <span><strong>本机：两张显卡 · 适合运行 14B 以内模型</strong></span>
  <a href="#">详细</a>
</div>`;

const pages = {
  'marketplace-home': theme => wrap(theme, '模型市场', `
<div class="row-bar"><h1>模型市场</h1><input class="btn" style="width:200px;text-align:left" placeholder="搜索…" readonly /></div>
${profileSimple}
<div class="tabs"><span class="tab on">对话</span><span class="tab">推理</span><span class="tab">代码</span></div>
<div class="section">为本机精选</div>
<div class="pick-grid">
  <div class="pick"><strong>Qwen3-8B-Instruct</strong><span class="badge b-ok">流畅</span><span class="badge b-agent">可用于智能体任务</span><p class="reason">${s8.tier} · 约每秒 ${s8.chars} 字（估算）</p></div>
  <div class="pick"><strong>Qwen3-14B-Instruct</strong><span class="badge b-ok">流畅</span><span class="badge b-agent">可用于智能体任务</span><p class="reason">${s14.tier} · 约每秒 ${s14.chars} 字（估算）</p></div>
  <div class="pick"><strong>Qwen3-4B-Instruct</strong><span class="badge b-ok">流畅</span><span class="badge b-agent">可用于智能体任务</span><p class="reason">${s4.tier} · 约每秒 ${s4.chars} 字（估算）</p></div>
  <div class="pick"><strong>Qwen3-32B-Instruct</strong><span class="badge b-no">不推荐</span><p class="reason">单卡显存不够完整加载</p></div>
</div>
<div class="section">全部模型</div>
<div class="list">
  <div class="lrow"><div><strong>Qwen3-8B-Instruct</strong><br/><span style="color:#64748B;font-size:11px">可商用 · Apache 2.0</span></div><a style="color:#2563EB;font-size:12px" href="#">详情</a></div>
  <div class="lrow"><div><strong>Qwen3-14B-Instruct</strong></div><a style="color:#2563EB;font-size:12px" href="#">详情</a></div>
</div>
<p style="font-size:11px;color:#64748B;margin-top:8px">向量模型已在后台自动配置，无需在市场下载。</p>`),

  'model-detail': theme => wrap(theme, '详情', `
<div class="row-bar"><h1>Qwen3-8B-Instruct</h1><button class="btn">返回</button></div>
${profileSimple}
<div class="panel hero">
  <span class="badge b-ok">流畅</span> <span class="badge b-agent">可用于智能体任务</span>
  <p class="lead" style="margin-top:8px">按推荐配置可在<strong>一张显卡</strong>上完整运行，另一张可留给后台任务；无需把模型拆到两张卡。</p>
  <p class="speed">${s8.tier} · 约每秒 ${s8.chars} 字（估算）</p>
  <p class="license">可商用 · Apache 2.0</p>
  <div style="margin-top:12px"><button class="btn btn-main">下载（推荐版本 Q4_K_M）</button></div>
</div>
<details><summary>其他版本</summary>
  <table><tr><th>版本</th><th>大小</th><th>结论</th><th></th></tr>
  <tr><td>Q5_K_M</td><td>5.9 GB</td><td>流畅</td><td><button class="btn">下载</button></td></tr>
  <tr><td>Q8_0</td><td>8.2 GB</td><td>可用</td><td><button class="btn">下载</button></td></tr></table>
</details>
<details><summary>详细</summary>
  <p style="margin-top:8px;color:#64748B">推荐加载：上下文 40K · 记忆缓存 q8_0 · 文件 5.0 GB（权重同文件大小）</p>
  <p>单卡显存约 7.0 GB / 16 GB · 未使用 CPU 卸载</p>
  <table><tr><th>显卡</th><th>用途</th><th>占用</th></tr>
  <tr><td>显卡 1 · 4090M 16GB</td><td>本模型</td><td>7.0 GB</td></tr>
  <tr><td>显卡 2 · 4090M 16GB</td><td>向量模型（自动）</td><td>0.6 GB</td></tr></table>
  <p style="margin-top:8px;font-size:11px;color:#64748B">速度估算：576×0.6÷5.0≈${s8.center.toFixed(1)} tok/s，展示 ${s8.low}–${s8.high}（±15%）</p>
</details>`),

  download: theme => wrap(theme, '下载', `
<div class="row-bar"><h1>正在下载 Qwen3-8B</h1></div>
<div class="panel">
  <p>下载中…</p>
  <p style="font-size:11px;color:#64748B;margin-top:4px">已检查磁盘空间（需要约 5.5 GB）</p>
  <p style="margin-top:8px;font-size:12px">3.10 / 5.00 GB</p>
  <div class="progress"><i></i></div>
  <div style="margin-top:12px;display:flex;gap:6px"><button class="btn">暂停</button><button class="btn">取消</button><button class="btn">重试</button></div>
</div>
<div class="panel" style="opacity:0.85">
  <p><strong>下载完成（示意）</strong></p>
  <p style="font-size:12px;margin-top:6px">文件已校验，已加入本地模型库。</p>
  <button class="btn btn-main" style="margin-top:10px">设为助手默认模型</button>
  <button class="btn" style="margin-left:6px">稍后再说</button>
</div>`),

  'local-models': theme => wrap(theme, '本地模型', `
<div class="row-bar"><h1>本地模型</h1><button class="btn">导入文件</button></div>
${profileSimple}
<div class="list">
  <div class="lrow"><div><strong>Qwen3-8B-Instruct</strong> <span class="badge b-ok">运行中</span> <span style="color:#64748B;font-size:11px">★ 助手默认</span></div><button class="btn">卸载</button></div>
  <div class="lrow"><div><strong>Qwen3-14B-Instruct</strong> <span style="color:#64748B">未加载</span></div><div><button class="btn btn-main">加载</button> <button class="btn">删除</button></div></div>
</div>
<div class="section" style="margin-top:12px">后台模型（自动）</div>
<div class="list"><div class="lrow"><div><strong>向量模型</strong> <span style="font-size:11px;color:#64748B">自动安装 · 运行在显卡 2</span></div><button class="btn">详细</button></div></div>
<p style="font-size:11px;color:#64748B;margin-top:8px">使用笔记本时，未插电可能更慢，建议连接电源。</p>`),

  'empty-states': theme => wrap(theme, '空态', `
<div class="row-bar"><h1>模型市场</h1></div>
<div class="banner banner-info"><span><strong>浏览版</strong> · 可以逛模型市场，下载和运行请从<strong>官网</strong>安装完整版。</span><button class="btn btn-main">打开官网下载</button></div>
<div class="panel empty"><h2 style="font-size:15px">暂时连不上模型目录，先用内置推荐。</h2><button class="btn btn-main" style="margin-top:12px">使用内置推荐</button><button class="btn" style="margin-left:6px">重试</button></div>
<div class="banner banner-warn"><span>当前 CUDA 安装包无法使用这块显卡，已改用 CPU 运行。建议从官网安装 <strong>CPU 版</strong>。</span><button class="btn">了解 CPU 版</button></div>`),
};

for (const [name, builder] of Object.entries(pages)) {
  for (const theme of ['light', 'dark']) {
    fs.writeFileSync(path.join(dir, `${name}-${theme}.html`), builder(theme), 'utf8');
  }
}
console.log('done', Object.keys(pages).length * 2, 'files');
