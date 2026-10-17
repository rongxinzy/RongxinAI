import { imageData } from '../assets.mjs';
import { bars, esc, metricHtml } from '../html.mjs';
import { pageShell } from '../shell.mjs';

export function slidePage(c, index) {
  const coverImage =
    c.id === 'pptx-product-plan'
      ? `<div class="slide-photo"><img src="${imageData(c.art)}" alt="${esc(c.label)}场景"></div>`
      : '';
  const narratives = {
    'pptx-education': [
      ['一块柏油路，为什么比草地更烫？', '先预测，再测量；让学生用真实观察修正直觉。'],
      ['同一时刻，三种地表', c.steps[0]],
      ['热从哪里来，又怎样留下？', c.steps[1]],
      ['给校园画一张阴凉地图', c.steps[2]],
      ['离开教室前，解释证据', c.insight],
    ],
    'pptx-ai-intro': [
      ['从一次提问开始，而不是从模型开始', '产品路演：让引用、权限、行动构成一条可信工作流。'],
      ['知识散落，答案难以复核', c.steps[0]],
      ['把来源和访问权带进回答', c.steps[1]],
      ['先打穿高频支持场景', c.steps[2]],
      ['用四周试点验证复用', c.insight],
    ],
    'pptx-training': [
      ['别背话术，先听懂顾客真正要什么', '半天的现场演练：判断、确认、补救、复盘。'],
      ['情景卡一：情绪高，信息少', c.steps[0]],
      ['情景卡二：复述后确认边界', c.steps[1]],
      ['情景卡三：承诺必须可兑现', c.steps[2]],
      ['主管用观察表反馈行为', c.insight],
    ],
    'pptx-product-plan': [
      ['这台相机，想让人每天都带出门', '首发计划围绕轻量旅行与真实拍摄场景展开。'],
      ['预热：样张来自真实旅程', c.steps[0]],
      ['首发：门店让人拿起来拍', c.steps[1]],
      ['复购：镜头和课程接上体验', c.steps[2]],
      ['90 天看体验，不只看曝光', c.insight],
    ],
    'pptx-content-research': [
      ['功能清单相似，谁能让企业放心？', '竞品比较改看治理责任、数据边界和迁移成本。'],
      ['先锁定企业买家的决策任务', c.steps[0]],
      ['四个维度重画竞争地图', c.steps[1]],
      ['找到两个未验证的空档', c.steps[2]],
      ['定位来自证据，不来自口号', c.insight],
    ],
    'pptx-annual-review': [
      ['修复岸线之后，鸟回来了吗？', '年度影响故事区分现场记录、估算与长期目标。'],
      ['三处样地，记录不同变化', c.steps[0]],
      ['让公众巡护成为连续证据', c.steps[1]],
      ['监测时间比单年数字更重要', c.steps[2]],
      ['把生态效果和归因边界说清', c.insight],
    ],
    'pptx-fundraising': [
      ['海岸是基础设施，也需要长期照护', '向伙伴说明资金如何转成可公开检查的修复进度。'],
      ['先和社区确认基线与目标', c.steps[0]],
      ['小规模试点，按季巡查', c.steps[1]],
      ['资金去向和指标同步公开', c.steps[2]],
      ['不承诺无法归因的碳收益', c.insight],
    ],
  };
  const pages = narratives[c.id] ?? [
    [c.title, c.lead],
    ['先看现场，再看数据', c.steps[0]],
    ['证据把直觉变成判断', c.insight],
    ['把复杂拆成三段', c.steps[1]],
    ['行动从最小验证开始', c.steps[2]],
  ];
  const bullets = pages
    .map(
      (p, i) =>
        `<article class="slide ${i === 0 ? 'current' : ''}" data-slide="${i}"><span class="eyebrow">FIELD NOTE / ${String(i + 1).padStart(2, '0')} — ${esc(c.label)}</span><h2>${esc(p[0])}</h2><p>${esc(p[1])}</p>${i === 2 ? bars(c.chart) : `<div class="big-number">${esc(c.metrics[i % 3][0])}</div><div class="slide-rule"></div><p class="small">${esc(c.metrics[i % 3][1])} · 演示方案 / 不代表实际承诺</p>`}</article>`,
    )
    .join('');
  return pageShell(
    c,
    `<div class="deck"><header><div><span class="eyebrow">NARRATIVE DECK / ${String(index + 1).padStart(2, '0')}</span><strong>${esc(c.label)}</strong></div><div class="deck-top-right">${String(index + 1).padStart(2, '0')} <i></i> 08</div></header><main><aside><span class="eyebrow">TODAY'S QUESTION</span><h1>${esc(c.title)}</h1><p>${esc(c.lead)}</p><div class="metrics">${metricHtml(c.metrics)}</div></aside><div class="slides">${pages.map((p, i) => `<button class="slide-nav ${i === 0 ? 'active' : ''}" data-go="${i}"><b>0${i + 1}</b><span>${esc(p[0])}</span></button>`).join('')}<div class="slide-window">${pages.map((p, i) => `<article class="slide ${i === 0 ? 'current' : ''}" data-slide="${i}"><span class="eyebrow">CHAPTER 0${i + 1} / ${esc(c.label)}</span><h2>${esc(p[0])}</h2><p>${esc(p[1])}</p>${i === 2 ? bars(c.chart) : `<div class="big-number">${esc(c.metrics[i % 3][0])}</div><div class="slide-rule"></div><p class="small">${esc(c.metrics[i % 3][1])} · 演示内容</p>`}${i === 0 ? coverImage : ''}</article>`).join('')}</div><div class="deck-controls"><button class="step" data-step="-1">← 上一页</button><span id="counter">01 / 05</span><button class="step" data-step="1">下一页 →</button></div></div></main><footer>演示内容 · 请按实际资料校准　　${esc(c.insight)}</footer></div>`,
    `body{background:#111b1a;color:#ecebe2}.deck{min-height:100vh;padding:0 7vw}.deck>header{height:72px;border-bottom:1px solid #ffffff23;display:flex;align-items:center;justify-content:space-between;color:#e7e9df}.deck header strong{margin-left:16px;letter-spacing:.08em}.deck-top-right{font:11px ui-monospace;color:#8e9e96}.deck-top-right i{display:inline-block;width:48px;height:1px;background:var(--accent);vertical-align:middle;margin:0 8px}.deck main{min-height:calc(100vh - 126px);display:grid;grid-template-columns:.85fr 1.15fr;gap:8vw;align-items:center;padding:42px 0}.deck aside h1{font:500 clamp(40px,5vw,68px)/1.06 Georgia,"Songti SC",serif;letter-spacing:-.06em;margin:22px 0}.deck aside>p{color:#aab8ae;max-width:38ch}.metrics{display:grid;grid-template-columns:repeat(3,1fr);margin-top:50px;border-top:1px solid #fff2}.metric{padding:15px 8px;border-color:#fff2}.metric strong{font-size:18px}.metric span{color:#91a199}.slides{min-width:0}.slide-window{height:400px;position:relative;overflow:hidden;background:#eeeae0;color:#202725}.slide{display:none;height:100%;padding:38px;position:relative}.slide.current{display:block;animation:fade .24s ease}.slide h2{font:500 clamp(30px,3.5vw,48px)/1.13 Georgia,"Songti SC",serif;max-width:17ch;letter-spacing:-.045em;margin:26px 0 12px}.slide>p{color:#606a62;max-width:48ch}.big-number{position:absolute;right:34px;bottom:40px;color:var(--accent);font:500 72px/1 ui-monospace,monospace}.slide-rule{position:absolute;left:38px;right:42%;bottom:67px;height:1px;background:#c8cec6}.small{position:absolute;bottom:28px;left:38px;color:#808b82!important;font-size:10px}.slide .bars{margin-top:40px}.slide-nav{width:100%;display:flex;gap:15px;text-align:left;align-items:baseline;border:0;border-bottom:1px solid #ffffff22;padding:10px 0;background:none;color:#8d9a91;font-size:11px}.slide-nav b{font:10px ui-monospace}.slide-nav.active{color:#f0eee4}.slide-nav.active b{color:var(--accent)}.deck-controls{display:flex;justify-content:space-between;align-items:center;padding-top:12px;color:#a3afa6;font:10px ui-monospace}.step{background:none;border:1px solid #ffffff30;color:#e6e9e0;padding:8px 12px}.deck footer{border-top:1px solid #ffffff22;padding:18px 0;color:#7e9086;font:10px ui-monospace}.eyebrow{color:#92a79d}.bar-col span{color:#606a62}.bar-col i{background:var(--accent)}.slide-photo{position:absolute;inset:0 0 0 52%;overflow:hidden;z-index:0}.slide-photo img{width:100%;height:100%;object-fit:cover}.slide-photo:after{content:'';position:absolute;inset:0;background:linear-gradient(90deg,#111b1a,transparent 30%)}.slide>*:not(.slide-photo){position:relative;z-index:1}.slide .big-number{position:absolute;z-index:2}@keyframes fade{from{opacity:.2;transform:translateY(3px)}to{opacity:1;transform:none}}@media(max-width:760px){.deck{padding:0 20px}.deck main{grid-template-columns:1fr;gap:28px}.deck aside h1{font-size:42px}.metrics{margin-top:23px}.slide-window{height:340px}.slide{padding:25px}.slide h2{font-size:31px}.deck footer{margin-top:5px}}`,
    `let current=0;const slides=[...document.querySelectorAll('[data-slide]')],nav=[...document.querySelectorAll('.slide-nav')];function show(i){current=(i+slides.length)%slides.length;slides.forEach((x,j)=>x.classList.toggle('current',j===current));nav.forEach((x,j)=>x.classList.toggle('active',j===current));document.querySelector('#counter').textContent=String(current+1).padStart(2,'0')+' / 05'}nav.forEach(b=>b.onclick=()=>show(+b.dataset.go));document.querySelectorAll('[data-step]').forEach(b=>b.onclick=()=>show(current+(+b.dataset.step)));`,
  );
}
