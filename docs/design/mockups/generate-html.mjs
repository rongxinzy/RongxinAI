#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

const dir = path.dirname(new URL(import.meta.url).pathname);

function css(theme) {
  const light = theme === 'light';
  return `
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: Inter, -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif;
  font-size: 13px; line-height: 1.5;
  color: ${light ? '#0A1628' : '#E8EBF0'};
  background: ${light ? '#FAFBFD' : '#0A0E1A'};
  min-height: 100vh;
}
.mono { font-family: 'JetBrains Mono', Menlo, monospace; font-size: 12px; }
.app { max-width: 1280px; margin: 0 auto; padding: 24px 32px 48px; }
.header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; }
.header h1 { font-size: 20px; font-weight: 600; }
.header-actions { display: flex; gap: 8px; align-items: center; }
.search {
  width: 280px; height: 32px; padding: 0 12px; border-radius: 8px;
  border: 1px solid ${light ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.1)'};
  background: ${light ? 'rgba(255,255,255,0.9)' : 'rgba(30,35,50,0.9)'};
  color: inherit;
}
.btn {
  height: 32px; padding: 0 14px; border-radius: 8px; border: none; cursor: pointer;
  font-size: 13px; font-weight: 500;
}
.btn-primary {
  color: #fff;
  background: linear-gradient(135deg, ${light ? '#3B82F6' : '#60A5FA'} 0%, ${light ? '#8B5CF6' : '#A78BFA'} 100%);
  box-shadow: 0 4px 12px ${light ? 'rgba(59,130,246,0.25)' : 'rgba(96,165,250,0.3)'};
}
.btn-outline {
  background: transparent;
  border: 1px solid ${light ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.12)'};
  color: inherit;
}
.glass {
  background: ${light ? 'rgba(255,255,255,0.92)' : 'rgba(20,24,36,0.88)'};
  backdrop-filter: blur(12px);
  border: 1px solid ${light ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.08)'};
  border-radius: 12px;
  box-shadow: 0 4px 12px ${light ? 'rgba(0,0,0,0.06)' : 'rgba(0,0,0,0.35)'};
}
.profile { padding: 16px 20px; margin-bottom: 16px; display: grid; grid-template-columns: 1fr auto; gap: 16px; align-items: center; }
.profile-meta { display: flex; flex-wrap: wrap; gap: 16px 24px; }
.profile-item label { display: block; font-size: 11px; color: ${light ? '#A0AEC0' : '#4A5568'}; margin-bottom: 4px; }
.profile-item strong { font-size: 13px; }
.gpu-bars { display: flex; gap: 12px; }
.gpu-mini { width: 140px; }
.bar-track { height: 6px; border-radius: 3px; background: ${light ? '#E2E8F0' : '#1E293B'}; overflow: hidden; margin-top: 6px; }
.bar-fill { height: 100%; border-radius: 3px; background: linear-gradient(90deg, #3B82F6, #8B5CF6); }
.tabs { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 16px; }
.tab {
  height: 28px; padding: 0 12px; border-radius: 999px; font-size: 12px;
  border: 1px solid ${light ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.1)'};
  background: ${light ? 'rgba(255,255,255,0.6)' : 'rgba(30,35,50,0.6)'};
  color: ${light ? '#4A5568' : '#A0AEC0'};
}
.tab.active {
  background: ${light ? '#fff' : 'rgba(96,165,250,0.15)'};
  color: ${light ? '#0A1628' : '#E8EBF0'};
  border-color: ${light ? 'rgba(59,130,246,0.35)' : 'rgba(96,165,250,0.4)'};
}
.tab.disabled { opacity: 0.45; }
.section-title { font-size: 15px; font-weight: 600; margin: 20px 0 12px; }
.grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
.card { padding: 16px 18px; }
.card h3 { font-size: 15px; font-weight: 600; margin-bottom: 4px; }
.card .sub { font-size: 12px; color: ${light ? '#4A5568' : '#A0AEC0'}; margin-bottom: 10px; }
.tags { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 12px; }
.tag { font-size: 11px; padding: 2px 8px; border-radius: 6px; background: ${light ? '#F1F5F9' : '#1E293B'}; color: ${light ? '#4A5568' : '#A0AEC0'}; }
.fit-row { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
.fit-bar { flex: 1; height: 8px; border-radius: 4px; background: ${light ? '#E2E8F0' : '#1E293B'}; overflow: hidden; display: flex; }
.seg-w { width: 45%; background: #3B82F6; }
.seg-k { width: 30%; background: #8B5CF6; }
.seg-b { width: 10%; background: #94A3B8; }
.badge { font-size: 11px; font-weight: 500; padding: 2px 8px; border-radius: 6px; }
.badge-ok { background: ${light ? '#D1FAE5' : 'rgba(52,211,153,0.15)'}; color: ${light ? '#047857' : '#34D399'}; }
.badge-warn { background: ${light ? '#FEF3C7' : 'rgba(251,191,36,0.15)'}; color: ${light ? '#B45309' : '#FBBF24'}; }
.badge-muted { background: ${light ? '#F1F5F9' : '#1E293B'}; color: ${light ? '#64748B' : '#94A3B8'}; }
.carousel { display: flex; gap: 12px; overflow-x: auto; padding-bottom: 8px; margin-bottom: 8px; }
.carousel .card { min-width: 260px; flex-shrink: 0; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid ${light ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.08)'}; }
th { font-size: 11px; font-weight: 500; color: ${light ? '#A0AEC0' : '#64748B'}; }
.stack-bar { height: 24px; border-radius: 8px; overflow: hidden; display: flex; margin: 12px 0; }
.stack-bar span { display: flex; align-items: center; justify-content: center; font-size: 10px; color: #fff; }
.s-w { background: #3B82F6; flex: 4.2; }
.s-k { background: #8B5CF6; flex: 2.1; }
.s-b { background: #64748B; flex: 0.5; }
.s-free { flex: 1.2; background: ${light ? '#E2E8F0' : '#334155'}; color: ${light ? '#64748B' : '#94A3B8'}; }
.two-col { display: grid; grid-template-columns: 1fr 320px; gap: 20px; }
.sidebar-panel { padding: 20px; position: sticky; top: 24px; }
.steps { list-style: none; }
.steps li { display: flex; gap: 12px; padding: 12px 0; border-bottom: 1px solid ${light ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.08)'}; }
.step-num { width: 24px; height: 24px; border-radius: 50%; background: ${light ? '#EFF6FF' : 'rgba(96,165,250,0.2)'}; color: ${light ? '#2563EB' : '#60A5FA'}; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 600; flex-shrink: 0; }
.step-num.done { background: ${light ? '#D1FAE5' : 'rgba(52,211,153,0.2)'}; color: ${light ? '#059669' : '#34D399'}; }
.progress { height: 8px; border-radius: 4px; background: ${light ? '#E2E8F0' : '#1E293B'}; overflow: hidden; margin-top: 8px; }
.progress > div { height: 100%; background: linear-gradient(90deg, #3B82F6, #8B5CF6); width: 67%; }
.radio-group { display: flex; flex-direction: column; gap: 8px; margin: 12px 0; }
.radio { display: flex; align-items: flex-start; gap: 10px; padding: 12px; border-radius: 8px; border: 1px solid ${light ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.1)'}; }
.radio.selected { border-color: ${light ? 'rgba(59,130,246,0.5)' : 'rgba(96,165,250,0.5)'}; background: ${light ? 'rgba(59,130,246,0.04)' : 'rgba(96,165,250,0.08)'}; }
.banner { padding: 14px 18px; border-radius: 10px; margin-bottom: 16px; display: flex; justify-content: space-between; align-items: center; gap: 16px; }
.banner-warn { background: ${light ? '#FFFBEB' : 'rgba(251,191,36,0.12)'}; border: 1px solid ${light ? '#FDE68A' : 'rgba(251,191,36,0.3)'}; }
.banner-info { background: ${light ? '#EFF6FF' : 'rgba(96,165,250,0.12)'}; border: 1px solid ${light ? '#BFDBFE' : 'rgba(96,165,250,0.3)'}; }
.empty { text-align: center; padding: 48px 24px; }
.empty h2 { font-size: 17px; margin-bottom: 8px; }
.empty p { color: ${light ? '#4A5568' : '#A0AEC0'}; max-width: 420px; margin: 0 auto 20px; }
.footer-sticky { margin-top: 24px; padding: 16px 20px; display: flex; justify-content: flex-end; gap: 8px; position: sticky; bottom: 0; }
.mock-label { position: fixed; top: 8px; right: 8px; font-size: 10px; opacity: 0.5; }
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
<span class="mock-label">静态稿 · ${theme === 'light' ? '浅色' : '深色'}</span>
<div class="app">${body}</div>
</body>
</html>`;
}

const profileBlock = `
<div class="glass profile">
  <div class="profile-meta">
    <div class="profile-item"><label>推理后端</label><strong>CUDA · llama-server b9244 · sm_89</strong></div>
    <div class="profile-item"><label>系统内存</label><strong class="mono">64 GB</strong></div>
    <div class="profile-item"><label>Work 模式建议上下文</label><strong class="mono">32K</strong></div>
    <div class="gpu-bars">
      <div class="gpu-mini"><label style="font-size:11px;color:var(--m,#888)">GPU 0 · RTX 4060 Ti 16GB</label><div class="bar-track"><div class="bar-fill" style="width:18%"></div></div><span class="mono" style="font-size:11px">2.9 / 16 GB 空闲</span></div>
      <div class="gpu-mini"><label style="font-size:11px">GPU 1 · RTX 4060 Ti 16GB</label><div class="bar-track"><div class="bar-fill" style="width:12%"></div></div><span class="mono" style="font-size:11px">14.1 / 16 GB 空闲</span></div>
    </div>
  </div>
  <div style="display:flex;gap:8px">
    <button class="btn btn-outline">重新检测</button>
    <button class="btn btn-outline">一键诊断</button>
  </div>
</div>`;

const pages = {
  'marketplace-home': (theme) =>
    wrap(
      theme,
      '模型市场首页',
      `
<div class="header">
  <h1>模型市场</h1>
  <div class="header-actions">
    <input class="search" placeholder="搜索模型、发布者、标签…" />
    <button class="btn btn-outline">下载队列 · 1</button>
  </div>
</div>
${profileBlock}
<div class="tabs">
  <span class="tab active">全部</span><span class="tab">对话</span><span class="tab">推理</span><span class="tab">代码</span>
  <span class="tab">视觉 / OCR</span><span class="tab">向量</span><span class="tab disabled">语音 · 即将推出</span>
  <span class="tab disabled">视频 · 16GB+</span>
</div>
<p class="section-title">为本机精选</p>
<div class="carousel">
  <div class="glass card"><h3>Qwen3-8B-Instruct</h3><p class="sub">Qwen · 对话 / 代码</p><span class="badge badge-ok">流畅</span> <span class="mono" style="margin-left:8px">22–30 tok/s · Q4_K_M</span></div>
  <div class="glass card"><h3>DeepSeek-R1-Distill-7B</h3><p class="sub">推理专用</p><span class="badge badge-ok">流畅</span> <span class="mono" style="margin-left:8px">18–26 tok/s</span></div>
  <div class="glass card"><h3>Qwen2.5-VL-7B</h3><p class="sub">视觉 · 需 mmproj</p><span class="badge badge-warn">可玩</span> <span class="mono" style="margin-left:8px">12–18 tok/s</span></div>
</div>
<p class="section-title">全部模型</p>
<div class="grid">
  <div class="glass card">
    <h3>Qwen3-14B-GGUF</h3><p class="sub">ModelScope · Apache-2.0</p>
    <div class="tags"><span class="tag">对话</span><span class="tag">工具调用</span></div>
    <div class="fit-row"><div class="fit-bar"><div class="seg-w"></div><div class="seg-k"></div><div class="seg-b"></div></div><span class="badge badge-warn">可玩</span></div>
    <p class="mono" style="font-size:11px;color:#888;margin-bottom:12px">推荐 Q4_K_M · 预估 VRAM 11.2 GB / 32K 上下文</p>
    <button class="btn btn-primary" style="width:100%">查看详情</button>
  </div>
  <div class="glass card">
    <h3>Llama-3.1-8B-Instruct</h3><p class="sub">hf-mirror 同步</p>
    <div class="tags"><span class="tag">对话</span></div>
    <div class="fit-row"><div class="fit-bar"><div class="seg-w" style="width:35%"></div><div class="seg-k" style="width:25%"></div></div><span class="badge badge-ok">流畅</span></div>
    <button class="btn btn-primary" style="width:100%">查看详情</button>
  </div>
</div>`,
    ),

  'model-detail': (theme) =>
    wrap(
      theme,
      '模型详情',
      `
<div class="header"><h1>Qwen3-8B-Instruct · GGUF</h1><button class="btn btn-outline">← 返回市场</button></div>
${profileBlock}
<div class="two-col">
  <div>
    <div class="glass card" style="margin-bottom:16px">
      <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:12px">
        <div><h3 style="font-size:17px">本机流畅度</h3><p class="sub">基于权重 + KV cache + 32K 上下文 · 双卡 tensor split</p></div>
        <span class="badge badge-ok">流畅</span>
      </div>
      <div class="stack-bar"><span class="s-w">权重 4.2G</span><span class="s-k">KV 2.1G</span><span class="s-b">缓冲</span><span class="s-free">余量 9.7G</span></div>
      <table>
        <tr><th>项目</th><th>估算</th><th>说明</th></tr>
        <tr><td>GPU 显存合计</td><td class="mono">6.8 GB</td><td>GPU0 3.6G + GPU1 3.2G 层切分</td></tr>
        <tr><td>系统内存</td><td class="mono">1.4 GB</td><td>CPU offload 余量</td></tr>
        <tr><td>上下文</td><td class="mono">32,768</td><td>符合 Work 模式守卫</td></tr>
        <tr><td>tokens/s</td><td class="mono">22 – 30</td><td>置信度 B · 目录 benchmark</td></tr>
      </table>
      <p style="margin-top:12px;font-size:12px;color:#888">拖动上下文滑块可实时重算 KV 段（实现时绑定 ggufKvCacheEstimate）</p>
      <input type="range" min="4096" max="131072" value="32768" style="width:100%;margin-top:8px" />
    </div>
    <div class="glass card">
      <h3>量化版本</h3>
      <table style="margin-top:12px">
        <tr><th>量化</th><th>大小</th><th>VRAM</th><th>流畅度</th><th></th></tr>
        <tr><td>Q4_K_M ★</td><td class="mono">5.1 GB</td><td class="mono">6.8 GB</td><td><span class="badge badge-ok">流畅</span></td><td><button class="btn btn-primary">下载</button></td></tr>
        <tr><td>Q5_K_M</td><td class="mono">6.0 GB</td><td class="mono">7.9 GB</td><td><span class="badge badge-ok">流畅</span></td><td><button class="btn btn-outline">下载</button></td></tr>
        <tr><td>Q8_0</td><td class="mono">8.4 GB</td><td class="mono">10.6 GB</td><td><span class="badge badge-warn">可玩</span></td><td><button class="btn btn-outline">下载</button></td></tr>
      </table>
    </div>
  </div>
  <div class="glass sidebar-panel">
    <h3>运行时证据</h3>
    <ul style="list-style:none;margin-top:12px;font-size:12px;line-height:2">
      <li>✓ GGUF SHA256 已校验</li>
      <li>✓ chat template 已文档化</li>
      <li>◐ 工具调用 · 待探针</li>
      <li>— mmproj 不适用</li>
    </ul>
    <div class="footer-sticky" style="position:static;padding:16px 0 0">
      <button class="btn btn-primary" style="flex:1">下载并安装</button>
    </div>
  </div>
</div>`,
    ),

  download: (theme) =>
    wrap(
      theme,
      '下载',
      `
<div class="header"><h1>下载 Qwen3-8B · Q4_K_M</h1></div>
<div class="two-col">
  <div class="glass card">
    <h3>选择下载源</h3>
    <div class="radio-group">
      <div class="radio selected"><input type="radio" checked /> <div><strong>ModelScope</strong><p class="sub" style="margin:0">国内访问稳定，推荐大多数用户</p></div></div>
      <div class="radio"><input type="radio" /> <div><strong>hf-mirror</strong><p class="sub" style="margin:0">无需访问 huggingface.co，与目录 revision 对齐</p></div></div>
    </div>
    <h3 style="margin-top:20px">文件</h3>
    <table style="margin-top:8px">
      <tr><td class="mono">Qwen3-8B-Q4_K_M.gguf</td><td class="mono">5.1 GB</td><td><span class="badge badge-muted">等待</span></td></tr>
    </table>
    <h3 style="margin-top:20px">进度</h3>
    <p class="mono">3.42 / 5.10 GB · 断点续传已启用</p>
    <div class="progress"><div></div></div>
    <p style="font-size:12px;margin-top:8px;color:#888">下一步：SHA256 校验 → 写入 模型库/modelscope/Qwen/…</p>
  </div>
  <div class="glass sidebar-panel">
    <h3>步骤</h3>
    <ol class="steps">
      <li><span class="step-num done">✓</span><div><strong>选择源</strong><p class="sub">ModelScope</p></div></li>
      <li><span class="step-num">2</span><div><strong>下载</strong><p class="sub">67% · 可取消</p></div></li>
      <li><span class="step-num">3</span><div><strong>校验 SHA256</strong></div></li>
      <li><span class="step-num">4</span><div><strong>加载模型</strong></div></li>
    </ol>
    <button class="btn btn-outline" style="width:100%;margin-top:12px">取消下载</button>
  </div>
</div>`,
    ),

  'local-models': (theme) =>
    wrap(
      theme,
      '本地模型',
      `
<div class="header">
  <h1>本地模型</h1>
  <div class="header-actions">
    <span class="mono" style="color:#888">磁盘占用 42.3 GB</span>
    <button class="btn btn-outline">导入 GGUF</button>
    <button class="btn btn-primary">前往模型市场</button>
  </div>
</div>
${profileBlock.replace('一键诊断', '诊断 · 导出 JSON')}
<div class="glass card">
  <table>
    <tr><th>模型</th><th>大小</th><th>状态</th><th>显存</th><th>上下文</th><th>操作</th></tr>
    <tr>
      <td><strong>Qwen3-8B-Instruct</strong><br/><span class="mono" style="font-size:11px;color:#888">Q4_K_M</span></td>
      <td class="mono">5.1 GB</td>
      <td><span class="badge badge-ok">运行中</span></td>
      <td class="mono">6.8 / 32 GB</td>
      <td class="mono">32K</td>
      <td><button class="btn btn-outline">卸载</button> <button class="btn btn-primary">设置</button></td>
    </tr>
    <tr>
      <td><strong>DeepSeek-R1-7B</strong></td>
      <td class="mono">4.8 GB</td>
      <td><span class="badge badge-muted">未加载</span></td>
      <td class="mono">—</td>
      <td class="mono">16K</td>
      <td><button class="btn btn-primary">加载</button></td>
    </tr>
  </table>
</div>
<div class="glass card" style="margin-top:16px">
  <h3>服务与并发</h3>
  <p class="sub">llama-server · 端口 8081 · 并发 slot 2 · 默认 keep-alive 30 分钟</p>
  <button class="btn btn-outline" style="margin-top:8px">打开启动日志</button>
</div>`,
    ),

  'empty-states': (theme) =>
    wrap(
      theme,
      '空态与引导',
      `
<div class="header"><h1>模型市场</h1></div>
<div class="banner banner-info">
  <div><strong>Lite 版 · 尚未安装本地推理运行时</strong><p style="font-size:12px;margin-top:4px;opacity:0.85">仍可浏览目录；下载与加载需先安装 CPU 或 CUDA 版 llama.cpp b9244</p></div>
  <button class="btn btn-primary">安装运行时</button>
</div>
<div class="glass empty">
  <h2>目录暂时不可用</h2>
  <p>无法连接 models.rongxzyai.com。您仍可使用内置 SQLite 精选包离线浏览；恢复后将自动同步更新。</p>
  <button class="btn btn-primary">使用内置精选</button>
  <button class="btn btn-outline" style="margin-left:8px">重试</button>
</div>
<div class="banner banner-warn" style="margin-top:24px">
  <div><strong>未检测到 NVIDIA GPU</strong><p style="font-size:12px;margin-top:4px">CUDA 版模型无法加速；建议切换 CPU+Vulkan 后端或选择更小量化。</p></div>
  <button class="btn btn-outline">切换 CPU 后端</button>
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
