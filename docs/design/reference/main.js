// 参考页交互：主题热切换、视图切换、输入岛状态、侧栏选中与折叠。
// 主题切换只改 data-theme，不重建 DOM，草稿、焦点、展开状态全部保留。
/* global lucide */

lucide.createIcons();

const root = document.documentElement;
const qsa = (selector) => [...document.querySelectorAll(selector)];

function press(group, active) {
  qsa(group).forEach((el) => el.setAttribute('aria-pressed', String(el === active)));
}

qsa('[data-theme-set]').forEach((btn) =>
  btn.addEventListener('click', () => {
    root.dataset.theme = btn.dataset.themeSet;
    press('[data-theme-set]', btn);
    renderSwatches();
  }),
);

qsa('[data-view]').forEach((btn) =>
  btn.addEventListener('click', () => {
    qsa('.view').forEach((view) => (view.hidden = view.id !== `view-${btn.dataset.view}`));
    press('[data-view]', btn);
  }),
);

// 问候语随时段变化
const hour = new Date().getHours();
const part = hour < 6 ? '夜深了' : hour < 12 ? '早上好' : hour < 18 ? '下午好' : '晚上好';
document.getElementById('greet').textContent = `${part}，今天想完成什么？`;

// 输入岛：高度自适应；只有存在可提交内容时，发送键才使用品牌色
const prompt = document.getElementById('prompt');
const send = document.getElementById('send');
prompt.addEventListener('input', () => {
  prompt.style.height = 'auto';
  prompt.style.height = `${Math.min(prompt.scrollHeight, 200)}px`;
  send.disabled = prompt.value.trim() === '';
});

qsa('.seg button').forEach((btn) =>
  btn.addEventListener('click', () => {
    qsa('.seg button').forEach((el) => el.setAttribute('aria-selected', String(el === btn)));
  }),
);

qsa('[data-nav]').forEach((btn) =>
  btn.addEventListener('click', () => {
    qsa('[aria-current="page"]').forEach((el) => el.removeAttribute('aria-current'));
    btn.setAttribute('aria-current', 'page');
  }),
);

qsa('.folder').forEach((folder) =>
  folder.addEventListener('click', () => {
    const open = folder.getAttribute('aria-expanded') === 'true';
    folder.setAttribute('aria-expanded', String(!open));
    let node = folder.nextElementSibling;
    while (node && !node.classList.contains('folder')) {
      node.hidden = open;
      node = node.nextElementSibling;
    }
  }),
);

// 规范页色板：直接读取当前主题的计算值，保证文档与实现一致
const SWATCHES = [
  ['--zy-surface', '窗口底 / 侧栏'],
  ['--zy-background', '主内容面板'],
  ['--card', '输入岛 / 抬升表面'],
  ['--popover', '浮层'],
  ['--zy-text-primary', '主文字'],
  ['--zy-text-muted-foreground', '次文字'],
  ['--zy-text-muted', '元信息 / 占位'],
  ['--zy-border', '默认描边'],
  ['--zy-input-border', '输入岛描边'],
  ['--zy-primary', '品牌蓝 · 主动作'],
  ['--zy-success', '成功 / 运行'],
  ['--zy-destructive', '危险 / 错误'],
];

function renderSwatches() {
  const styles = getComputedStyle(root);
  document.getElementById('swatches').innerHTML = SWATCHES.map(([token, desc]) => {
    const value = styles.getPropertyValue(token).trim();
    return `<div class="sw"><i style="background:${value}"></i><div><b>${desc}</b><code>${token}</code><br><code>${value}</code></div></div>`;
  }).join('');
}

renderSwatches();
