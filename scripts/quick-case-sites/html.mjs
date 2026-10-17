// Small HTML fragment helpers shared by every quick-case page generator.

export function esc(value) {
  return String(value).replace(
    /[&<>"']/g,
    char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  );
}
export function metricHtml(metrics) {
  return metrics
    .map(
      ([value, label]) =>
        `<div class="metric"><strong>${esc(value)}</strong><span>${esc(label)}</span></div>`,
    )
    .join('');
}
export function list(items, cls = '') {
  return `<ul class="${cls}">${items.map(item => `<li>${esc(item)}</li>`).join('')}</ul>`;
}
export function bars(points, labels = ['一月', '二月', '三月', '四月', '五月', '六月']) {
  return `<div class="bars" role="img" aria-label="演示数据趋势">${points.map((v, i) => `<div class="bar-col"><i style="--h:${v}%"></i><span>${labels[i] ?? `0${i + 1}`}</span></div>`).join('')}</div>`;
}
