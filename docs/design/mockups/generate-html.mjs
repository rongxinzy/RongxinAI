#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

const dir = path.dirname(new URL(import.meta.url).pathname);

function css(theme) {
  const light = theme === 'light';
  const bg = light ? '#F4F5F7' : '#0C0F14';
  const surface = light ? '#FFFFFF' : '#151922';
  const border = light ? '#E2E5EB' : '#252A35';
  const muted = light ? '#64748B' : '#94A3B8';
  return `
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: Inter, -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif;
  font-size: 13px; line-height: 1.45;
  color: ${light ? '#0F172A' : '#E2E8F0'};
  background: ${bg};
  min-height: 100vh;
}
.mono { font-family: 'JetBrains Mono', Menlo, monospace; font-size: 12px; }
.app { max-width: 1180px; margin: 0 auto; padding: 12px 20px 32px; }
.toolbar { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
.toolbar h1 { font-size: 18px; font-weight: 600; flex: 1; }
.search {
  width: 240px; height: 30px; padding: 0 10px; border-radius: 6px;
  border: 1px solid ${border}; background: ${surface}; color: inherit; font-size: 12px;
}
.btn {
  height: 30px; padding: 0 12px; border-radius: 6px; font-size: 12px; font-weight: 500; cursor: pointer;
}
.btn-solid {
  background: ${light ? '#2563EB' : '#3B82F6'}; color: #fff; border: none;
}
.btn-ghost {
  background: ${surface}; border: 1px solid ${border}; color: inherit;
}
.panel {
  background: ${surface}; border: 1px solid ${border}; border-radius: 8px;
}
.profile {
  padding: 10px 14px; margin-bottom: 10px; display: grid; grid-template-columns: 1fr auto; gap: 12px; align-items: start;
}
.profile-row { display: flex; flex-wrap: wrap; gap: 14px 20px; font-size: 12px; }
.profile-row dt { color: ${muted}; margin-bottom: 2px; }
.gpu-alloc { margin-top: 10px; width: 100%; }
.gpu-alloc table { width: 100%; font-size: 12px; border-collapse: collapse; }
.gpu-alloc th { text-align: left; color: ${muted}; font-weight: 500; padding: 6px 8px; border-bottom: 1px solid ${border}; }
.gpu-alloc td { padding: 8px; border-bottom: 1px solid ${border}; vertical-align: middle; }
.vram-bar { height: 5px; border-radius: 2px; background: ${light ? '#E2E8F0' : '#334155'}; margin-top: 4px; overflow: hidden; }
.vram-bar i { display: block; height: 100%; background: ${light ? '#2563EB' : '#60A5FA'}; border-radius: 2px; }
.tabs { display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 10px; }
.tab {
  height: 26px; padding: 0 10px; border-radius: 6px; font-size: 12px;
  border: 1px solid ${border}; background: ${surface}; color: ${muted};
}
.tab.on { background: ${light ? '#EFF6FF' : '#1E3A5F'}; color: ${light ? '#1D4ED8' : '#93C5FD'}; border-color: ${light ? '#BFDBFE' : '#2563EB'}; }
.tab.dim { opacity: 0.5; }
.section-h { font-size: 12px; font-weight: 600; color: ${muted}; text-transform: none; margin: 12px 0 6px; letter-spacing: 0.02em; }
.pick-row { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 4px; margin-bottom: 6px; }
.pick {
  flex: 0 0 220px; padding: 10px 12px; border: 1px solid ${border}; border-radius: 8px; background: ${surface};
}
.pick strong { font-size: 13px; display: block; }
.pick p { font-size: 11px; color: ${muted}; margin: 4px 0 6px; line-height: 1.35; }
.model-list { border: 1px solid ${border}; border-radius: 8px; overflow: hidden; background: ${surface}; }
.model-row {
  display: grid; grid-template-columns: 1fr auto auto; gap: 12px; align-items: center;
  padding: 10px 14px; border-bottom: 1px solid ${border}; font-size: 12px;
}
.model-row:last-child { border-bottom: none; }
.model-row:hover { background: ${light ? '#F8FAFC' : '#1A2030'}; }
.model-name { font-weight: 600; font-size: 13px; }
.model-meta { color: ${muted}; font-size: 11px; margin-top: 2px; }
.tags { display: inline-flex; gap: 4px; margin-top: 4px; }
.tag { font-size: 10px; padding: 1px 6px; border-radius: 4px; background: ${light ? '#F1F5F9' : '#1E293B'}; color: ${muted}; }
.badge { font-size: 10px; font-weight: 600; padding: 2px 7px; border-radius: 4px; white-space: nowrap; }
.b-ok { background: ${light ? '#DCFCE7' : '#14532D'}; color: ${light ? '#166534' : '#86EFAC'}; }
.b-mid { background: ${light ? '#FEF9C3' : '#713F12'}; color: ${light ? '#854D0E' : '#FDE047'}; }
.b-no { background: ${light ? '#FEE2E2' : '#7F1D1D'}; color: ${light ? '#B91C1C' : '#FCA5A5'}; }
.link { color: ${light ? '#2563EB' : '#60A5FA'}; font-size: 12px; text-decoration: none; }
.conclusion-box { padding: 14px 16px; margin-bottom: 10px; }
.conclusion-box h2 { font-size: 16px; margin-bottom: 6px; display: flex; align-items: center; gap: 8px; }
.conclusion-box .lead { font-size: 13px; margin-bottom: 8px; }
.conclusion-box .speed { font-size: 14px; font-weight: 600; }
.conclusion-box .hint { font-size: 11px; color: ${muted}; margin-top: 4px; }
details { margin-top: 10px; border: 1px solid ${border}; border-radius: 8px; padding: 0 12px 12px; background: ${surface}; }
summary { cursor: pointer; padding: 10px 0; font-weight: 600; font-size: 12px; color: ${muted}; list-style: none; }
summary::-webkit-details-marker { display: none; }
.stack { height: 18px; border-radius: 4px; overflow: hidden; display: flex; margin: 8px 0; font-size: 9px; color: #fff; }
.sw { background: #2563EB; flex: 5; display:flex;align-items:center;justify-content:center; }
.sk { background: #6366F1; flex: 1; display:flex;align-items:center;justify-content:center; }
.sb { background: #64748B; flex: 0.3; }
table.data { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 8px; }
table.data th, table.data td { padding: 8px 10px; border-bottom: 1px solid ${border}; text-align: left; }
table.data th { color: ${muted}; font-weight: 500; }
.two { display: grid; grid-template-columns: 1fr 280px; gap: 12px; }
.side { padding: 12px 14px; }
.steps { list-style: none; font-size: 12px; }
.steps li { padding: 8px 0; border-bottom: 1px solid ${border}; display: flex; gap: 8px; }
.progress { height: 6px; background: ${light ? '#E2E8F0' : '#334155'}; border-radius: 3px; margin-top: 6px; }
.progress i { display: block; height: 100%; width: 67%; background: #2563EB; border-radius: 3px; }
.radio { border: 1px solid ${border}; border-radius: 6px; padding: 10px; margin: 6px 0; font-size: 12px; }
.radio.on { border-color: #2563EB; background: ${light ? '#F0F7FF' : '#172554'}; }
.banner { padding: 10px 14px; border-radius: 8px; margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center; gap: 12px; font-size: 12px; }
.banner-info { background: ${light ? '#EFF6FF' : '#1E3A5F'}; border: 1px solid ${light ? '#BFDBFE' : '#2563EB'}; }
.banner-warn { background: ${light ? '#FFFBEB' : '#422006'}; border: 1px solid ${light ? '#FDE68A' : '#CA8A04'}; }
.empty { text-align: center; padding: 36px 20px; }
.mock-label { position: fixed; top: 6px; right: 8px; font-size: 10px; color: ${muted}; }
`;
}

function wrap(theme, title, body) {
  return `<!DOCTYPE html>
<html lang="zh-CN" data-theme="${theme}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<style>${css(theme)}</style>
</head>
<body>
<span class="mock-label">静态稿 · ${theme === 'light' ? '浅色' : '深色'} · dual-4060ti-16g</span>
<div class="app">${body}</div>
</body>
</html>`;
}

const gpuAllocBlock = `
<div class="panel profile">
  <div>
    <div class="profile-row">
      <div><dt>推理引擎</dt><dd>CUDA · b9244</dd></div>
      <div><dt>内存</dt><dd class="mono">64 GB</dd></div>
      <div><dt>常用上下文</dt><dd class="mono">32K</dd></div>
    </div>
    <div class="gpu-alloc">
      <div class="section-h" style="margin-top:8px">GPU 分配</div>
      <table>
        <tr><th>显卡</th><th>模型</th><th>占用</th><th>说明</th></tr>
        <tr>
          <td>GPU 0 · 4060 Ti 16GB<div class="vram-bar"><i style="width:39%"></i></div></td>
          <td>Qwen3-8B Q4_K_M</td>
          <td class="mono">6.3 / 16 GB</td>
          <td>单卡加载，无跨卡切分</td>
        </tr>
        <tr>
          <td>GPU 1 · 4060 Ti 16GB<div class="vram-bar"><i style="width:4%"></i></div></td>
          <td>Qwen3-Embedding-0.6B</td>
          <td class="mono">0.6 / 16 GB</td>
          <td>并行向量模型</td>
        </tr>
      </table>
    </div>
  </div>
  <div style="display:flex;flex-direction:column;gap:6px">
    <button class="btn btn-ghost">重新检测</button>
    <button class="btn btn-ghost">诊断</button>
  </div>
</div>`;

const pages = {
  'marketplace-home': theme =>
    wrap(
      theme,
      '模型市场',
      `
<div class="toolbar">
  <h1>模型市场</h1>
  <input class="search" placeholder="搜索模型…" />
  <button class="btn btn-ghost">下载 1</button>
</div>
${gpuAllocBlock}
<div class="tabs">
  <span class="tab on">全部</span><span class="tab">对话</span><span class="tab">推理</span><span class="tab">代码</span>
  <span class="tab">视觉</span><span class="tab">向量</span><span class="tab dim">语音</span><span class="tab dim">视频</span>
</div>
<div class="section-h">为本机精选 · 档 dual-4060ti-16g</div>
<div class="pick-row">
  <div class="pick"><strong>Qwen3-8B-Instruct</strong><p>主对话；GPU 0 单卡即可。</p><span class="badge b-ok">流畅</span> <span class="mono" style="margin-left:6px;font-size:11px">约 35–45 tok/s（估算）</span></div>
  <div class="pick"><strong>Qwen3-Embedding-0.6B</strong><p>放 GPU 1，与主模型并行。</p><span class="badge b-ok">流畅</span></div>
  <div class="pick"><strong>Qwen3-14B-Instruct</strong><p>更强；单卡约 10GB 级占用。</p><span class="badge b-mid">可用</span> <span class="mono" style="font-size:11px">约 18–24 tok/s（估算）</span></div>
  <div class="pick"><strong>Qwen3-4B-Instruct</strong><p>低延迟备选。</p><span class="badge b-ok">流畅</span></div>
</div>
<div class="section-h">全部模型</div>
<div class="model-list">
  <div class="model-row">
    <div><div class="model-name">Qwen3-8B-Instruct</div><div class="model-meta">8B · Qwen · 推荐 Q4_K_M · 5.0 GB</div><div class="tags"><span class="tag">对话</span><span class="tag">代码</span></div></div>
    <div><span class="badge b-ok">流畅</span><div class="mono" style="font-size:11px;color:#64748B;margin-top:4px">35–45 tok/s（估算）</div></div>
    <a class="link" href="#">详情 →</a>
  </div>
  <div class="model-row">
    <div><div class="model-name">Qwen3-14B-Instruct</div><div class="model-meta">14B · 推荐 Q4_K_M · 8.6 GB</div><div class="tags"><span class="tag">对话</span><span class="tag">推理</span></div></div>
    <div><span class="badge b-mid">可用</span><div class="mono" style="font-size:11px;margin-top:4px">18–24 tok/s（估算）</div></div>
    <a class="link" href="#">详情 →</a>
  </div>
  <div class="model-row">
    <div><div class="model-name">Qwen3-4B-Instruct</div><div class="model-meta">4B · 推荐 Q4_K_M · 2.6 GB</div></div>
    <div><span class="badge b-ok">流畅</span><div class="mono" style="font-size:11px;margin-top:4px">55–70 tok/s（估算）</div></div>
    <a class="link" href="#">详情 →</a>
  </div>
  <div class="model-row">
    <div><div class="model-name">Qwen3-32B-Instruct</div><div class="model-meta">32B · Q4_K_M · 19 GB</div></div>
    <div><span class="badge b-no">不推荐</span><div class="mono" style="font-size:11px;margin-top:4px">单卡放不下</div></div>
    <a class="link" href="#">详情 →</a>
  </div>
</div>`,
    ),

  'model-detail': theme =>
    wrap(
      theme,
      '模型详情',
      `
<div class="toolbar"><h1>Qwen3-8B-Instruct</h1><button class="btn btn-ghost">← 返回</button></div>
${gpuAllocBlock}
<div class="panel conclusion-box">
  <h2><span class="badge b-ok">流畅</span> 本机运行结论</h2>
  <p class="lead">可在 <strong>GPU 0 单卡</strong>完整加载；GPU 1 仍可同时运行向量等小模型，<strong>无需跨显卡切分</strong>。</p>
  <p class="speed">预计速度：约 35–45 tok/s（估算）</p>
  <p class="hint">推荐 Q4_K_M · 文件 5.0 GB · 上下文 32K · CPU 卸载：无</p>
</div>
<details>
  <summary>详细：显存、GPU 与速度计算</summary>
  <p style="font-size:11px;color:#64748B;margin-top:8px">GPU 0 单卡 · split-mode none · main-gpu 0</p>
  <div class="stack"><span class="sw">权重 5.0G</span><span class="sk">KV 1.0G</span><span class="sb"></span></div>
  <table class="data">
    <tr><th>项目</th><th>数值</th></tr>
    <tr><td>GGUF 文件</td><td class="mono">5.0 GB（= GPU 权重）</td></tr>
    <tr><td>KV（32K）</td><td class="mono">~1.0 GB</td></tr>
    <tr><td>缓冲</td><td class="mono">~0.3 GB</td></tr>
    <tr><td>GPU 0 合计</td><td class="mono">~6.3 GB</td></tr>
    <tr><td>系统内存 offload</td><td>未使用 CPU 卸载</td></tr>
  </table>
  <p style="font-size:11px;margin-top:10px;line-height:1.5;color:#64748B">
    速度估算：4060 Ti 带宽 288 GB/s × 效率 0.6 → 172.8 GB/s 有效；decode ≈ 172.8×1024³÷(5.0×1024³)≈34.6 tok/s，展示区间 35–45（估算）。
  </p>
  <p style="font-size:11px;margin-top:6px;color:#64748B">文件校验已通过 · 对话模板已收录 · 工具调用：待验证</p>
</details>
<div class="panel" style="margin-top:10px;padding:12px 14px">
  <div class="section-h" style="margin:0 0 8px">量化版本</div>
  <table class="data">
    <tr><th>量化</th><th>文件</th><th>结论</th><th>速度（估算）</th><th></th></tr>
    <tr><td>Q4_K_M ★</td><td class="mono">5.0 GB</td><td><span class="badge b-ok">流畅</span></td><td class="mono">35–45</td><td><button class="btn btn-ghost">下载</button></td></tr>
    <tr><td>Q5_K_M</td><td class="mono">5.9 GB</td><td><span class="badge b-ok">流畅</span></td><td class="mono">30–38</td><td><button class="btn btn-ghost">下载</button></td></tr>
    <tr><td>Q8_0</td><td class="mono">8.2 GB</td><td><span class="badge b-mid">可用</span></td><td class="mono">20–26</td><td><button class="btn btn-ghost">下载</button></td></tr>
  </table>
  <div style="margin-top:12px;text-align:right"><button class="btn btn-solid">下载并安装</button></div>
</div>`,
    ),

  download: theme =>
    wrap(
      theme,
      '下载',
      `
<div class="toolbar"><h1>下载 · Qwen3-8B Q4_K_M</h1></div>
<div class="two">
  <div class="panel" style="padding:14px">
    <div class="section-h" style="margin-top:0">下载源</div>
    <div class="radio on"><strong>ModelScope</strong> — 国内访问推荐</div>
    <div class="radio"><strong>hf-mirror</strong> — 无需访问 Hugging Face 官网</div>
    <div class="section-h">文件 · 5.0 GB</div>
    <p class="mono" style="font-size:11px">Qwen3-8B-Q4_K_M.gguf</p>
    <div class="section-h">进度</div>
    <p class="mono" style="font-size:11px">3.35 / 5.00 GB · 支持断点续传</p>
    <div class="progress"><i></i></div>
  </div>
  <div class="panel side">
    <div class="section-h" style="margin-top:0">步骤</div>
    <ol class="steps">
      <li><span>✓</span> 已选 ModelScope</li>
      <li><span>2</span> 下载中 67%</li>
      <li><span>3</span> 校验文件</li>
      <li><span>4</span> 加入本地模型库</li>
    </ol>
    <button class="btn btn-ghost" style="width:100%;margin-top:8px">取消</button>
  </div>
</div>`,
    ),

  'local-models': theme =>
    wrap(
      theme,
      '本地模型',
      `
<div class="toolbar">
  <h1>本地模型</h1>
  <span class="mono" style="font-size:11px;color:#64748B">磁盘 38.2 GB</span>
  <button class="btn btn-ghost">导入</button>
  <button class="btn btn-ghost">模型市场</button>
</div>
${gpuAllocBlock}
<div class="panel">
  <table class="data">
    <tr><th>模型</th><th>文件</th><th>状态</th><th>显卡</th><th>占用</th><th>上下文</th><th></th></tr>
    <tr>
      <td><strong>Qwen3-8B-Instruct</strong><br/><span style="font-size:11px;color:#64748B">Q4_K_M</span></td>
      <td class="mono">5.0 GB</td>
      <td><span class="badge b-ok">运行中</span></td>
      <td class="mono">GPU 0</td>
      <td class="mono">6.3 GB</td>
      <td class="mono">32K</td>
      <td><button class="btn btn-ghost">卸载</button></td>
    </tr>
    <tr>
      <td><strong>Qwen3-Embedding-0.6B</strong></td>
      <td class="mono">0.6 GB</td>
      <td><span class="badge b-ok">运行中</span></td>
      <td class="mono">GPU 1</td>
      <td class="mono">0.6 GB</td>
      <td class="mono">8K</td>
      <td><button class="btn btn-ghost">卸载</button></td>
    </tr>
    <tr>
      <td><strong>Qwen3-14B-Instruct</strong></td>
      <td class="mono">8.6 GB</td>
      <td><span class="badge" style="background:#334155;color:#94A3B8">未加载</span></td>
      <td>—</td>
      <td>—</td>
      <td class="mono">32K</td>
      <td><button class="btn btn-solid">加载</button></td>
    </tr>
  </table>
</div>
<div class="panel" style="margin-top:10px;padding:12px 14px;font-size:12px;color:#64748B">
  本地服务运行中 · 已加载 2 个模型 · 第二卡可用于并行小模型，无需把主模型切到两张卡
</div>`,
    ),

  'empty-states': theme =>
    wrap(
      theme,
      '空态',
      `
<div class="toolbar"><h1>模型市场</h1></div>
<div class="banner banner-info">
  <div>尚未安装本地推理组件，可先浏览精选；下载与运行需安装 CPU 或 CUDA 引擎。</div>
  <button class="btn btn-solid">安装引擎</button>
</div>
<div class="panel empty">
  <h2 style="font-size:16px;margin-bottom:8px">暂时连不上模型目录</h2>
  <p style="font-size:12px;color:#64748B;max-width:400px;margin:0 auto 16px">可使用本机内置精选包继续浏览；网络恢复后会自动同步。</p>
  <button class="btn btn-solid">使用内置精选</button>
  <button class="btn btn-ghost" style="margin-left:6px">重试</button>
</div>
<div class="banner banner-warn" style="margin-top:12px">
  <div>未检测到 NVIDIA 显卡，CUDA 加速不可用。可改用 CPU 引擎或选择更小模型。</div>
  <button class="btn btn-ghost">改用 CPU 引擎</button>
</div>`,
    ),
};

for (const [name, builder] of Object.entries(pages)) {
  for (const theme of ['light', 'dark']) {
    const file = path.join(dir, `${name}-${theme}.html`);
    fs.writeFileSync(file, builder(theme), 'utf8');
    console.log('wrote', file);
  }
}
