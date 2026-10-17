import { imageData } from '../assets.mjs';
import { bars, esc, list, metricHtml } from '../html.mjs';
import { pageShell } from '../shell.mjs';

export function website(c, index) {
  const img = imageData(c.art);
  const visual = img
    ? `<div class="photo-panel"><img src="${img}" alt="${esc(c.label)}场景"><div class="photo-caption">FIELD NOTES · ${String(index + 1).padStart(2, '0')} / 08</div></div>`
    : `<div class="panel visual"><div class="orbit"></div><div class="sun"></div><div class="visual-copy"><span class="eyebrow">${esc(c.label)} / LIVE CONCEPT</span><strong>${esc(c.insight)}</strong><button class="button" data-action="explore">进入体验 ↗</button></div></div>`;
  const extra = c.id.includes('game')
    ? `<section class="section"><div class="section-head"><div><span class="eyebrow">WORD PUZZLE / 01</span><h2>拼出今天的线索</h2></div><p>试试点击字卡</p></div><div class="chips">${['潮汐', '月球', '引力', '海岸'].map(x => `<button class="chip word">${x}</button>`).join('')}</div><p id="feedback" class="note" style="margin-top:18px">选中两张卡片，组成一个关联线索。</p></section>`
    : c.id.includes('survey')
      ? `<section class="section"><div class="section-head"><div><span class="eyebrow">YOUR BLOCK / 03</span><h2>投下一票，看看街区怎么想</h2></div><p>本页为交互原型，票数仅作演示</p></div><div class="chips">${['遮荫座椅', '安全过街', '夜间照明'].map((x, i) => `<button class="chip vote" data-vote="${i}">${x}</button>`).join('')}</div><p id="feedback" class="note" style="margin-top:18px">选择最希望优先改善的项目。</p></section>`
      : c.id.includes('ops-console')
        ? `<section class="section"><div class="section-head"><div><span class="eyebrow">ENERGY DESK / TODAY</span><h2>屋顶发电运行概览</h2></div><div class="chips"><button class="chip period" aria-pressed="true">今日</button><button class="chip period">本周</button><button class="chip period">本月</button></div></div><div class="metrics">${metricHtml(
            [
              ['82.4%', '设备可用率'],
              ['1,248 kWh', '累计发电（演示）'],
              ['4 项', '待处理告警'],
            ],
          )}</div>${bars(c.chart)}</section>`
        : `<section class="section"><div class="section-head"><div><span class="eyebrow">THE EXPERIENCE</span><h2>${esc(c.insight)}</h2></div><p>为真实场景设计的可浏览原型</p></div><div class="split"><div class="panel"><span class="eyebrow">01 / ${esc(c.steps[0])}</span><h2>${esc(c.steps[1])}</h2><p>${esc(c.lead)}</p></div><div class="panel"><span class="eyebrow">02 / ${esc(c.steps[2])}</span><h2>把灵感带进下一步</h2><p>主要按钮、导航和表单提供可见反馈；内容以示例信息呈现。</p></div></div></section>`;
  const script = c.id.includes('game')
    ? `let chosen=[];document.querySelectorAll('.word').forEach(b=>b.onclick=()=>{b.classList.toggle('on');chosen.push(b.textContent);document.querySelector('#feedback').textContent=chosen.slice(-2).join(' + ')+'：尝试解释它们之间的关系。'})`
    : c.id.includes('survey')
      ? `document.querySelectorAll('.vote').forEach(b=>b.onclick=()=>{document.querySelector('#feedback').textContent='已记录演示选择：「'+b.textContent+'」。原型不会提交个人信息。';document.querySelectorAll('.vote').forEach(x=>x.setAttribute('aria-pressed',String(x===b)))})`
      : `document.querySelectorAll('.period').forEach(b=>b.onclick=()=>{document.querySelectorAll('.period').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));document.querySelector('.section-head p').textContent='当前视图：'+b.textContent+' · 演示数据'})`;
  const titleClass = index % 2 ? 'serif' : '';
  return pageShell(
    c,
    `<header class="top shell"><a class="brand" href="#top">${esc(c.label)} <span class="eyebrow">STUDIO / ${String(index + 1).padStart(2, '0')}</span></a><nav><a href="#story">故事</a><a href="#experience">体验</a><a href="#details">详情</a></nav><button class="button" data-action="explore">开始探索 ↗</button></header><main id="top" class="shell"><section class="hero" id="story"><div><span class="eyebrow">${esc(c.lead.split('，')[0])} / EDITION 2026</span><h1 class="${titleClass}">${esc(c.title)}</h1><p>${esc(c.lead)}</p><div class="chips"><a class="button" href="#experience">${c.id.includes('event') ? '查看活动安排' : c.id.includes('store') ? '探索本周批次' : '继续了解'} ↘</a><a class="button outline" href="#details">查看细节</a></div><p class="eyebrow" style="margin-top:22px">${esc(c.insight)}</p></div>${visual}</section><div class="metrics">${metricHtml(c.metrics)}</div><section class="section" id="experience">${extra}</section><section class="section" id="details"><div class="section-head"><div><span class="eyebrow">A SMALL PLAN / ${String(index + 1).padStart(2, '0')}</span><h2>从浏览到行动，只需三步</h2></div></div>${list(c.steps, 'rows')}</section></main><footer class="footer shell"><span>概念体验 · 示例内容</span><span>${esc(c.label)} / ${String(index + 1).padStart(2, '0')} of 08</span></footer>`,
    `.serif{font-family:Georgia,"Songti SC",serif;font-weight:450;letter-spacing:-.06em}.visual{position:relative;min-height:320px;overflow:hidden;background:#182a29;color:#e9efe8;border:0}.orbit{position:absolute;width:290px;height:290px;border:1px solid #77b6a2;border-radius:50%;left:22%;top:9%;box-shadow:0 0 0 35px #263a3544,0 0 0 70px #263a3522}.sun{position:absolute;width:34px;height:34px;border-radius:50%;background:#f0b46e;left:66%;top:28%;box-shadow:0 0 80px #f0b46e88}.visual-copy{position:absolute;inset:auto 22px 22px;z-index:2}.visual-copy strong{display:block;font:25px/1.25 Georgia,serif;max-width:20ch;margin:12px 0 16px}.visual-copy .button{background:#d1e5d8;color:#162521}.on,.chip[aria-pressed=true]{background:var(--accent);color:#15201c;border-color:var(--accent)}`,
    script,
  );
}
