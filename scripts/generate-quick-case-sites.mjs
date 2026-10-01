#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(root, 'scripts/quick-case-sites.json'), 'utf8'));
// English scenario text sits beside the manifest so the English prompt and description carry the same
// audience, scope and indicators as the Chinese one instead of a shared boilerplate sentence.
const enScenario = JSON.parse(readFileSync(join(root, 'scripts/quick-case-sites.en.json'), 'utf8'));
const outDir = join(root, 'SKILLs/frontend-design/templates/quick-cases');
const assetsDir = join(outDir, 'assets');
const cataloguePath = join(root, 'public/quick-actions.json');
const i18nPath = join(root, 'public/quick-actions-i18n.json');
const catalog = JSON.parse(readFileSync(cataloguePath, 'utf8'));
const i18n = JSON.parse(readFileSync(i18nPath, 'utf8'));

const configs = {
  pptx: {
    action: 'pptx',
    zh: '制作幻灯片',
    en: 'Create a presentation',
    kind: 'DECK / 16:9',
    accent: '#db9b4b',
  },
  excel: {
    action: 'data-analysis',
    zh: '数据分析',
    en: 'Analyze data',
    kind: 'WORKBOOK / LIVE VIEW',
    accent: '#43876d',
  },
  website: {
    action: 'website',
    zh: '创建网站',
    en: 'Create a website',
    kind: 'WEB EXPERIENCE / INTERACTIVE',
    accent: '#75b8ae',
  },
  research: {
    action: 'deep-research',
    zh: '深度调研',
    en: 'Deep research',
    kind: 'RESEARCH BRIEF / EVIDENCE LEDGER',
    accent: '#238d82',
  },
  academic: {
    action: 'academic-research',
    zh: '学术研究',
    en: 'Academic research',
    kind: 'RESEARCH DESIGN / METHODS',
    accent: '#9879c7',
  },
  docs: {
    action: 'docs',
    zh: '文档',
    en: 'Create a document',
    kind: 'FIELD GUIDE / DECISION DOCUMENT',
    accent: '#bc8250',
  },
};

const enLabels = {
  'pptx-work-report': 'Quarterly operating review',
  'excel-budget': 'Q4 budget control',
  'web-learning-lab': 'Tide science lab',
  'research-competitors': 'Team knowledge tools',
  'academic-outline': 'Human-AI teamwork study',
  'docs-prd': 'Product discovery brief',
  'pptx-education': 'Urban heat lesson',
  'pptx-ai-intro': 'AI knowledge session',
  'pptx-training': 'Service recovery workshop',
  'pptx-product-plan': 'Product review',
  'pptx-content-research': 'Collaboration market brief',
  'pptx-annual-review': 'Wetland impact story',
  'pptx-fundraising': 'Coastal resilience pitch',
  'image-to-excel': 'Invoice capture',
  'excel-summary': 'Margin mix review',
  'multi-excel-merge': 'Inventory consolidation',
  'excel-reconcile': 'Payment reconciliation',
  'excel-pivot': 'Channel retention',
  'excel-anomaly': 'Cooling load anomaly',
  'excel-forecast': 'Fresh food forecast',
  'web-resume': 'Coastal stay booking',
  'web-store': 'Coffee origin shop',
  'web-event': 'Riverside night market',
  'web-product-launch': 'Camera launch',
  'web-ops-console': 'Solar operations console',
  'web-survey': 'Public space survey',
  'web-game-2048': 'Word discovery game',
  'research-industry': 'AI data center cooling',
  'research-policy': 'Customer service AI policy',
  'research-literature': 'Critical mineral recycling',
  'research-user': 'Micromobility access',
  'research-market-entry': 'Vietnam electric mobility',
  'research-supply-chain': 'Supply concentration risk',
  'research-talent': 'AI talent measurement',
  'academic-polish': 'Argument revision',
  'academic-review': 'AI advice and judgment',
  'academic-data-analysis': 'Before-and-after evaluation',
  'academic-method': 'Study design comparison',
  'academic-defense': 'Thesis defense narrative',
  'academic-grant': 'Urban heat grant',
  'academic-ethics': 'Informed consent design',
  'docs-meeting': 'Decision-ready meeting record',
  'docs-report': 'Incident review',
  'docs-summary': 'Executive brief',
  'docs-notice': 'Maintenance notice',
  'docs-api': 'Webhook integration guide',
  'docs-polish': 'UX writing guide',
  'docs-sop': 'Guesthouse closing checklist',
  'pptx-climate': 'Urban flood resilience',
  'pptx-hiring': 'Design team hiring plan',
  'pptx-exhibit': 'Museum night exhibition',
  'pptx-cyber': 'Ransomware tabletop exercise',
  'excel-carbon': 'Supply chain emissions',
  'excel-staffing': 'Nursing roster fairness',
  'excel-energy': 'Household energy bill',
  'excel-clinic': 'Clinic wait-time analysis',
  'web-museum': 'Museum night walk',
  'web-restaurant': 'Mountain dining reservations',
  'web-climate-map': 'Neighborhood cool map',
  'web-language': 'Coastal dialect archive',
  'research-water': 'Drinking water evidence',
  'research-heat': 'Heat protection at work',
  'research-reuse': 'Building material reuse',
  'research-childcare': 'Childcare access study',
  'academic-replication': 'Replication preregistration',
  'academic-interview': 'Qualitative coding guide',
  'academic-survey': 'Cross-cultural scale adaptation',
  'academic-open-data': 'Research data governance',
  'docs-board': 'Board decision memo',
  'docs-grant': 'Community grant proposal',
  'docs-research-protocol': 'Multi-site study handbook',
  'docs-incident-comms': 'Data incident communications',
};

const enTitles = {
  'pptx-work-report': 'Turn delivery into a reason to renew',
  'excel-budget': 'The budget is on track; the mix is not',
  'web-learning-lab': 'Why are there two high tides each day?',
  'research-competitors': 'Which knowledge tool fits a team?',
  'academic-outline': 'How do work boundaries shape team rework?',
  'docs-prd': 'Turn scattered experience into a reviewable proposal',
  'pptx-education': 'Why does the city stay warm after sunset?',
  'pptx-ai-intro': 'Turn every search into a next action',
  'pptx-training': 'Turn a complaint into a moment of trust',
  'pptx-product-plan': 'A lighter camera for everyday stories',
  'pptx-content-research': 'Knowledge tools compete on governance',
  'pptx-annual-review': 'Make room for migratory birds',
  'pptx-fundraising': 'Bring the tidal flat back as a city buffer',
  'image-to-excel': 'Turn 120 invoices into an auditable payables list',
  'excel-summary': 'Revenue grew; promotions took the margin',
  'multi-excel-merge': 'Twelve stock sheets, one usable daily view',
  'excel-reconcile': 'Trace every payment from source to settlement',
  'excel-pivot': 'The channel with more leads may retain fewer',
  'excel-anomaly': 'Night cooling load should not stay this high',
  'excel-forecast': 'Forecast weekend strawberries before they spoil',
  'web-resume': 'Leave one night between mountain and sea',
  'web-store': 'From a Yunnan lot to your morning cup',
  'web-event': 'An evening unfolds along the river',
  'web-product-launch': 'Take less camera, bring more moments',
  'web-ops-console': 'Give every rooftop ray a destination',
  'web-survey': 'What should change first on your street?',
  'web-game-2048': 'Turn a word into a trail of clues',
  'research-industry': 'Will power or cooling bottleneck AI compute first?',
  'research-policy': 'Which duties apply before service AI goes live?',
  'research-literature': 'More recycling does not erase material risk',
  'research-user': 'Is parking distant, or the last mile unreliable?',
  'research-market-entry': 'Where should electric mobility enter Vietnam?',
  'research-supply-chain': 'Turn supplier concentration into action',
  'research-talent': 'Measure the AI talent gap before quoting it',
  'academic-polish': 'Repair the argument before polishing sentences',
  'academic-review': 'When does AI advice help or displace judgment?',
  'academic-data-analysis': 'Separate a real change from a concurrent shock',
  'academic-method': 'Stepped wedge or interrupted time series?',
  'academic-defense': 'Build a credible story from one question',
  'academic-grant': 'Turn neighborhood heat into a testable study',
  'academic-ethics': 'Make consent understandable before it is signed',
  'docs-meeting': 'Turn discussion into accountable next steps',
  'docs-report': 'Review the incident beyond “operator error”',
  'docs-summary': 'Turn six pages of operations into three decisions',
  'docs-notice': 'Explain maintenance, impact, and rollback clearly',
  'docs-api': 'Help a first-time integrator receive an event',
  'docs-polish': 'Make every product sentence easy to understand',
  'docs-sop': 'Close the guesthouse with a reliable checklist',
  'pptx-climate': 'How quickly can a city recover from a cloudburst?',
  'pptx-hiring': 'Define the work before choosing who to hire',
  'pptx-exhibit': 'Follow one artifact through a port city',
  'pptx-cyber': 'Who acts first in the hour after isolation?',
  'excel-carbon': 'The emissions hotspot may be in purchasing',
  'excel-staffing': 'Night shifts should not fall on the same people',
  'excel-energy': 'Did usage rise, or did peak rates?',
  'excel-clinic': 'The average wait is fine; why are patients leaving?',
  'web-museum': 'Follow one light into the city’s harbor past',
  'web-restaurant': 'Tonight’s menu follows the mountain harvest',
  'web-climate-map': 'Find a patch of shade within a five-minute walk',
  'web-language': 'Hear how one town names the sea wind',
  'research-water': 'Is there enough evidence about water at the tap?',
  'research-heat': 'Who cannot stop work during a heatwave?',
  'research-reuse': 'How can salvaged materials re-enter the market?',
  'research-childcare': 'A nearby childcare place may still be out of reach',
  'academic-replication': 'Write the replication plan before seeing results',
  'academic-interview': 'Why do researchers code the same interview differently?',
  'academic-survey': 'Translation is only the start of scale validation',
  'academic-open-data': 'How can research data open without exposing people?',
  'docs-board': 'Market entry: state the cost before the recommendation',
  'docs-grant': 'Turn a one-off activity into measurable community change',
  'docs-research-protocol': 'Help every study site follow the same protocol',
  'docs-incident-comms': 'What belongs in the first data incident notice?',
};

const imageCache = new Map();
function imageData(name) {
  if (!name) return '';
  const assetName = name === 'camera' ? 'camera-launch' : name === 'coast' ? 'coast-house' : name;
  if (!imageCache.has(assetName)) {
    const file = join(assetsDir, `${assetName}.jpg`);
    imageCache.set(assetName, `data:image/jpeg;base64,${readFileSync(file).toString('base64')}`);
  }
  return imageCache.get(assetName);
}

function esc(value) {
  return String(value).replace(
    /[&<>"']/g,
    char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  );
}
function metricHtml(metrics) {
  return metrics
    .map(
      ([value, label]) =>
        `<div class="metric"><strong>${esc(value)}</strong><span>${esc(label)}</span></div>`,
    )
    .join('');
}
function list(items, cls = '') {
  return `<ul class="${cls}">${items.map(item => `<li>${esc(item)}</li>`).join('')}</ul>`;
}
function bars(points, labels = ['一月', '二月', '三月', '四月', '五月', '六月']) {
  return `<div class="bars" role="img" aria-label="演示数据趋势">${points.map((v, i) => `<div class="bar-col"><i style="--h:${v}%"></i><span>${labels[i] ?? `0${i + 1}`}</span></div>`).join('')}</div>`;
}

const commonCss = `
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;color:#202523;background:#f5f4ef;font:14px/1.6 Inter,-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif}button,a{font:inherit}a{color:inherit;text-decoration:none}button{cursor:pointer;color:inherit}button:focus-visible,a:focus-visible{outline:2px solid var(--accent);outline-offset:3px}.shell{width:min(1180px,calc(100% - 64px));margin:auto}.eyebrow,.mono{font:10px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.14em;text-transform:uppercase;color:#7e8982}.top{height:64px;border-bottom:1px solid #deded7;display:flex;align-items:center;justify-content:space-between}.brand{font-weight:650;letter-spacing:.04em}.top nav{display:flex;gap:24px;color:#606862;font-size:12px}.hero{padding:66px 0 44px;display:grid;grid-template-columns:1.05fr .95fr;gap:46px;align-items:center}.hero h1{font-size:clamp(38px,5vw,66px);line-height:1.08;letter-spacing:-.055em;font-weight:560;margin:18px 0}.hero p{max-width:52ch;color:#657069;font-size:15px}.tag{display:inline-flex;padding:6px 10px;border:1px solid #d8dbd4;border-radius:999px;color:#536159;font-size:11px}.button{border:0;background:#202a26;color:#f7f4e9;padding:11px 16px;border-radius:4px}.outline{background:transparent;color:#202a26;border:1px solid #cbd0c9}.metrics{display:grid;grid-template-columns:repeat(3,1fr);border-top:1px solid #daddd6;border-bottom:1px solid #daddd6}.metric{padding:17px 20px;border-right:1px solid #daddd6;display:grid;gap:2px}.metric:last-child{border:0}.metric strong{font:500 24px/1.2 ui-monospace,monospace;letter-spacing:-.06em}.metric span{color:#79827c;font-size:11px}.section{padding:35px 0 46px;border-bottom:1px solid #deded7}.section h2{font-size:21px;letter-spacing:-.035em;margin:4px 0 17px}.section-head{display:flex;justify-content:space-between;gap:20px;align-items:end;margin-bottom:17px}.section-head p{color:#78817b;font-size:12px;margin:0}.split{display:grid;grid-template-columns:1fr 1fr;gap:30px}.panel{background:#fff;border:1px solid #e3e4de;padding:20px}.rows{list-style:none;margin:0;padding:0}.rows li{padding:12px 0;border-bottom:1px solid #ebede8;display:flex;justify-content:space-between;gap:16px}.rows li:last-child{border:0}.bars{height:180px;display:flex;align-items:end;gap:16px;padding:15px 5px 0;border-bottom:1px solid #dce0da}.bar-col{height:100%;flex:1;display:flex;flex-direction:column;justify-content:end;align-items:center;gap:8px;color:#838d86;font-size:10px}.bar-col i{display:block;width:min(30px,72%);height:var(--h);background:var(--accent);opacity:.84;border-radius:3px 3px 0 0}.note{border-left:2px solid var(--accent);padding:12px 16px;background:#fff;font-size:13px;color:#4d5b53}.footer{padding:20px 0 35px;color:#818a84;font-size:10px;display:flex;justify-content:space-between}.chips{display:flex;gap:8px;flex-wrap:wrap}.chip{padding:7px 11px;border:1px solid #d8ddd6;background:transparent;border-radius:999px;color:#66716a;font-size:11px}.chip[aria-pressed=true]{background:#202a26;color:#fff;border-color:#202a26}.image{width:100%;height:320px;object-fit:cover;display:block}.photo-panel{position:relative;overflow:hidden;background:#dfe4dc}.photo-panel img{height:100%;min-height:320px;object-fit:cover}.photo-caption{position:absolute;bottom:0;left:0;right:0;padding:28px 18px 14px;color:white;background:linear-gradient(transparent,rgba(10,20,18,.64));font:10px ui-monospace,monospace;letter-spacing:.1em}
@media(max-width:760px){.shell{width:calc(100% - 36px)}.top nav{gap:12px}.top nav a:nth-child(n+3){display:none}.hero{grid-template-columns:1fr;gap:24px;padding:42px 0 28px}.hero h1{font-size:42px}.metrics{grid-template-columns:1fr}.metric{border-right:0;border-bottom:1px solid #daddd6;padding:12px 15px}.metric strong{font-size:20px}.split{grid-template-columns:1fr}.section{padding:27px 0}.image,.photo-panel img{min-height:230px;height:230px}.footer{gap:12px;flex-direction:column}}
`;

const casePalettes = {
  'pptx-education': ['#425b38', '#f5f0dc', '#263226', '#fffdf3'],
  'pptx-ai-intro': ['#7c6df1', '#090d1c', '#eff1ff', '#171b34'],
  'pptx-training': ['#e35e43', '#f7eee7', '#332a25', '#fffaf4'],
  'pptx-product-plan': ['#d89045', '#ede9e0', '#272624', '#f8f6ef'],
  'pptx-content-research': ['#32a88d', '#e7f0ec', '#23332e', '#f6faf7'],
  'pptx-annual-review': ['#799252', '#e9eddf', '#293327', '#f8f8f0'],
  'pptx-fundraising': ['#62c8d2', '#071b2a', '#e5f5f0', '#102d3a'],
  'image-to-excel': ['#d28c39', '#fbf4e7', '#30291f', '#fffaf0'],
  'excel-summary': ['#bc6449', '#f4ece7', '#342c28', '#fffaf7'],
  'multi-excel-merge': ['#658a9b', '#edf2f3', '#253239', '#fbfdfd'],
  'excel-reconcile': ['#bd9b4f', '#20231e', '#f2efe5', '#2a2e27'],
  'excel-pivot': ['#a967b2', '#f5eef6', '#342839', '#fffaff'],
  'excel-anomaly': ['#ef7759', '#171e26', '#e5ecf0', '#222c36'],
  'excel-forecast': ['#68996a', '#f0f3e7', '#293326', '#fcfff6'],
  'web-resume': ['#65a9b1', '#edf5f2', '#233638', '#fbfffc'],
  'web-store': ['#bb6a3e', '#f3e7d6', '#392a20', '#fff8eb'],
  'web-event': ['#e55245', '#17100f', '#fff0dc', '#261917'],
  'web-product-launch': ['#73a9f5', '#111820', '#edf1f7', '#1d2933'],
  'web-ops-console': ['#a6dc77', '#141b18', '#edf3df', '#1c2721'],
  'web-survey': ['#7c66c5', '#f0edf9', '#2c2840', '#fffefe'],
  'web-game-2048': ['#f7c747', '#f6e7bd', '#263747', '#fff5db'],
  'research-industry': ['#2fa4b5', '#e9f1f1', '#1f3033', '#f8fbfa'],
  'research-policy': ['#7b8fc8', '#edf0f7', '#242b3a', '#fbfcff'],
  'research-literature': ['#b27948', '#f4eee4', '#342b20', '#fffaf2'],
  'research-user': ['#d17d62', '#f8efeb', '#352a28', '#fffaf7'],
  'research-market-entry': ['#518b68', '#eaf1e8', '#28382d', '#fbfff8'],
  'research-supply-chain': ['#cd6851', '#f4ece8', '#332b29', '#fffcfa'],
  'research-talent': ['#6b77ae', '#edf0f8', '#272a3a', '#fcfcff'],
  'academic-polish': ['#bd5d59', '#f8eeee', '#392928', '#fffafa'],
  'academic-review': ['#547cac', '#edf2f8', '#273241', '#fafcff'],
  'academic-data-analysis': ['#9c754b', '#f3eee6', '#372f27', '#fffaf3'],
  'academic-method': ['#5c8f86', '#eaf2ef', '#253631', '#fafffc'],
  'academic-defense': ['#654aa2', '#f0edf7', '#2f2a3c', '#fffefe'],
  'academic-grant': ['#759253', '#edf1e4', '#2d3628', '#fcfff7'],
  'academic-ethics': ['#bd7799', '#f7edf3', '#372b33', '#fffaff'],
  'docs-meeting': ['#468d79', '#edf3ed', '#27332e', '#fbfff9'],
  'docs-report': ['#c16c54', '#f5ece7', '#392d29', '#fffbf8'],
  'docs-summary': ['#4384a8', '#edf3f6', '#27323a', '#fbfdff'],
  'docs-notice': ['#ce873e', '#f6efe0', '#352f24', '#fffaf0'],
  'docs-api': ['#6f79d0', '#eff0fb', '#292b40', '#fbfbff'],
  'docs-polish': ['#c15d6f', '#f8ecef', '#3a2930', '#fffafd'],
  'docs-sop': ['#77914d', '#eff1e6', '#30362b', '#fdfff8'],
  'pptx-climate': ['#309aab', '#071d2a', '#e7f1ec', '#102c38'],
  'pptx-hiring': ['#e5ad42', '#f7f1e4', '#342d20', '#fffaf0'],
  'pptx-exhibit': ['#c85b3c', '#f4e9db', '#32251e', '#fff8ef'],
  'pptx-cyber': ['#57d7c4', '#101623', '#e7f3f0', '#1a2430'],
  'excel-carbon': ['#4f8971', '#eaf0e8', '#27342e', '#fbfff9'],
  'excel-staffing': ['#6386c1', '#edf1f8', '#283141', '#fcfdff'],
  'excel-energy': ['#d39845', '#27231b', '#f4ecdc', '#332c20'],
  'excel-clinic': ['#50a9a0', '#e8f3f1', '#263735', '#fafffe'],
  'web-museum': ['#d99a52', '#201810', '#f4ead7', '#2b2118'],
  'web-restaurant': ['#b74436', '#f4e9dc', '#36251f', '#fffaf2'],
  'web-climate-map': ['#417eab', '#eaf1f5', '#24323b', '#fbfdff'],
  'web-language': ['#47a69b', '#102b30', '#e5f3ed', '#19373b'],
  'research-water': ['#398aa8', '#eaf2f5', '#23343c', '#fbfeff'],
  'research-heat': ['#bc6745', '#f4ece6', '#372c27', '#fffaf7'],
  'research-reuse': ['#768a4d', '#eef0e3', '#303629', '#fdfff6'],
  'research-childcare': ['#b56f92', '#f5edf2', '#372b34', '#fffbff'],
  'academic-replication': ['#405bb7', '#edf0f9', '#292e41', '#fcfcff'],
  'academic-interview': ['#a96447', '#f5ede6', '#352b26', '#fffcf8'],
  'academic-survey': ['#4b9589', '#eaf2ed', '#273630', '#fbfff9'],
  'academic-open-data': ['#7b6eb5', '#f0edf7', '#302c3b', '#fffefe'],
  'docs-board': ['#286f91', '#eaf0f3', '#26323a', '#fcfeff'],
  'docs-grant': ['#729351', '#edf1e4', '#2f3828', '#fdfff7'],
  'docs-research-protocol': ['#bd8b43', '#f3eee2', '#353025', '#fffaf0'],
  'docs-incident-comms': ['#ba5660', '#f6ecec', '#392a2e', '#fffbfb'],
};

function caseSkin(c) {
  const palette = casePalettes[c.id];
  if (!palette) return '';
  const [accent, background, ink, surface] = palette;
  const root = `body[data-case="${c.id}"]`;
  const base = `${root}{--accent:${accent};--case-bg:${background};--case-ink:${ink};--case-surface:${surface};background:${background};color:${ink}}${root} .panel,${root} .slide-window,${root} .docblock,${root} .evidence,${root} .questionbox{background:${surface};color:${ink}}${root} .eyebrow{color:${accent}}${root} .metric strong{color:${ink}}`;
  const layouts = {
    'pptx-education': `${root} .deck main{grid-template-columns:1fr;gap:24px;align-content:start}${root} .deck aside{display:grid;grid-template-columns:1fr auto;align-items:end}${root} .deck aside h1{max-width:13ch}${root} .slides{display:grid;grid-template-columns:repeat(5,1fr);gap:4px}${root} .slide-window{grid-column:1/-1;grid-row:2;min-height:360px}${root} .slide-nav{border:1px solid #425b3833;padding:12px;display:grid}${root} .slide-nav.active{background:#425b3818}
`,
    'pptx-ai-intro': `${root} .deck main{grid-template-columns:.68fr 1.32fr;gap:5vw}${root} .deck aside h1{font-family:Inter,Arial,sans-serif;font-weight:750;letter-spacing:-.07em}${root} .slide-window{height:460px}${root} .slide h2{font-family:Inter,Arial,sans-serif;font-weight:700}${root} .slide-nav{border-left:2px solid #ffffff14;border-bottom:0;padding-left:14px}${root} .slide-nav.active{border-left-color:${accent};background:#7c6df11a}
`,
    'pptx-training': `${root} .deck main{grid-template-columns:1fr;gap:20px}${root} .slides{display:grid;grid-template-columns:repeat(5,1fr);gap:8px}${root} .slide-nav{border:1px solid #e35e4344;padding:10px;display:grid;min-height:66px}${root} .slide-window{grid-row:2;height:330px}${root} .slide h2{font-family:Inter,Arial,sans-serif;font-weight:700}${root} .slide.current{border-top:7px solid ${accent}}
`,
    'pptx-product-plan': `${root} .deck main{grid-template-columns:.72fr 1.28fr;gap:3vw}${root} .deck aside h1{font-family:Georgia,serif;font-weight:400}${root} .slide-window{height:455px;background:#191a18;color:#f4f1e8}${root} .slide{background:linear-gradient(120deg,#191a18,#32302a);color:#f4f1e8}${root} .slide>p{color:#c3beb3}${root} .big-number{color:${accent}}${root} .slide-nav{font-size:10px}
`,
    'pptx-content-research': `${root} .deck main{grid-template-columns:1fr;align-content:start;gap:16px}${root} .deck aside{display:grid;grid-template-columns:1.2fr .8fr;align-items:center}${root} .deck aside h1{font-size:clamp(34px,4vw,54px)}${root} .deck aside .metrics{margin:0}${root} .slides{display:grid;grid-template-columns:200px 1fr;gap:18px}${root} .slide-window{height:390px}${root} .slide-nav{border-bottom:1px solid #23332e22}
`,
    'pptx-annual-review': `${root} .deck{max-width:1340px}${root} .deck main{grid-template-columns:.9fr 1.1fr}${root} .deck aside h1,.slide h2{font-family:Georgia,"Songti SC",serif;font-weight:400}${root} .slide-window{background:#e0e8d8;border:1px solid #79925255}${root} .slide{background:#e0e8d8}${root} .slide-nav{border-style:dotted}${root} .deck footer{color:#526244}
`,
    'pptx-fundraising': `${root} .deck{padding-left:9vw;padding-right:9vw}${root} .deck main{grid-template-columns:1fr;gap:15px;align-content:center}${root} .deck aside{display:grid;grid-template-columns:1fr auto;align-items:end}${root} .deck aside h1{font-size:clamp(40px,5vw,65px);max-width:14ch}${root} .deck aside .metrics{grid-column:1/-1;max-width:700px;margin-top:20px}${root} .slides{display:grid;grid-template-columns:repeat(5,1fr);gap:8px}${root} .slide-window{grid-column:1/-1;grid-row:2;height:300px;background:#102d3a}${root} .slide{background:#102d3a;color:#e5f5f0}${root} .slide>p{color:#b3cbc5}${root} .big-number{font-size:58px}
`,
    'image-to-excel': `${root} .rail{background:#43311f}${root} .analysis{grid-template-columns:.72fr 1.28fr}${root} .analysis .panel:first-child{background:#30291f;color:#fff8ed}${root} .analysis .panel:first-child .eyebrow{color:#f0bd68}${root} .gridtable{border-top:4px solid ${accent}}${root} .sheethead h1{font-family:Georgia,serif}
`,
    'excel-summary': `${root} .app{grid-template-columns:1fr}${root} .rail{display:none}${root} .work{max-width:1220px;margin:auto;width:100%}${root} .analysis{grid-template-columns:1.25fr .75fr}${root} .kpis{border:0;border-bottom:2px solid ${accent};background:transparent}${root} .kpis .metric{border-top:1px solid #bc644944}${root} .gridtable{box-shadow:0 12px 32px #342c280c}
`,
    'multi-excel-merge': `${root} .app{grid-template-columns:86px 1fr}${root} .rail{padding:24px 10px}${root} .rail a{font-size:0}${root} .rail a:first-letter{font-size:15px}${root} .analysis{grid-template-columns:1fr}${root} .analysis .panel:first-child{display:none}${root} .gridtable{border-radius:0 20px 20px 20px;overflow:hidden}
`,
    'excel-reconcile': `${root} .app{grid-template-columns:1fr}${root} .rail{display:none}${root} .work{background:#20231e;color:#f2efe5;padding-left:7vw;padding-right:7vw}${root} .worktop{border-color:#ffffff22;color:#c0c4b9}${root} .worktop .button{color:#f2efe5;border-color:#ffffff33}${root} .sheethead p,${root} .table-head>span{color:#adb2a7}${root} .kpis,${root} .gridtable,${root} .panel{background:#2a2e27;color:#f2efe5;border-color:#ffffff20}${root} td,${root} th{border-color:#ffffff20}${root} th{background:#33382f;color:#c4c9bc}
`,
    'excel-pivot': `${root} .rail{background:#342839}${root} .analysis{grid-template-columns:.75fr 1.25fr}${root} .analysis .panel:first-child{grid-column:2;grid-row:1}${root} .analysis .panel:last-child{grid-column:1;grid-row:1}${root} .bars{height:230px}${root} .bar-col i{border-radius:14px 14px 0 0}
`,
    'excel-anomaly': `${root} .app{grid-template-columns:155px 1fr}${root} .rail{background:#222c36}${root} .work{background:#171e26;color:#e5ecf0}${root} .worktop{border-color:#ffffff20;color:#b6c4cb}${root} .sheethead p{color:#a3b0b8}${root} .kpis,${root} .panel,${root} .gridtable{background:#222c36;border-color:#35434d;color:#e5ecf0}${root} .analysis{grid-template-columns:1fr 1fr}${root} .bar-col i{box-shadow:0 0 18px #ef775955}
`,
    'excel-forecast': `${root} .app{grid-template-columns:1fr}${root} .rail{display:none}${root} .work{max-width:1080px;margin:auto;width:100%}${root} .sheethead h1{font-family:Georgia,serif;font-weight:450}${root} .analysis{grid-template-columns:1.4fr .6fr}${root} .analysis .panel:first-child{background:#e1ead7}${root} .bar-col i{border-radius:14px 14px 0 0}${root} .gridtable{border-left:5px solid ${accent}}
`,
    'web-resume': `${root} .hero{min-height:650px;position:relative;display:block;padding-top:130px}${root} .hero>div:first-child{position:relative;z-index:2;max-width:540px;background:#fbfffcf2;padding:28px}${root} .photo-panel{position:absolute;inset:0 0 0 28%;z-index:0}${root} .photo-panel img{height:100%;object-position:58% center}${root} .photo-caption{top:16px;bottom:auto;background:none;color:#fff;text-align:right}
`,
    'web-store': `${root} .top{border-bottom:2px solid #392a20}${root} .hero{grid-template-columns:.82fr 1.18fr;padding-top:34px}${root} .hero h1{font-family:Georgia,serif;font-weight:400}${root} .photo-panel{border-radius:48% 48% 2px 2px}${root} .photo-panel img{height:410px}${root} .button{background:#bb6a3e}${root} .section{border-bottom:0}
`,
    'web-event': `${root} .shell{width:min(760px,calc(100% - 40px))}${root} .top{height:54px;border-bottom-color:#ffffff28;color:#fff0dc}${root} .top nav{color:#d3bcb0}${root} .hero{display:flex;flex-direction:column;text-align:center;gap:0;padding:45px 0 35px}${root} .hero>div:first-child{order:2}${root} .photo-panel{order:1;width:100%;height:220px}${root} .photo-panel img{height:100%;min-height:0;filter:saturate(.7)}${root} .hero h1{font:400 clamp(42px,7vw,72px)/.98 Georgia,serif}${root} .button{background:#e55245}${root} .metrics{border-color:#ffffff30}${root} .metric{border-color:#ffffff30}
`,
    'web-product-launch': `${root} .shell{width:100%}${root} .top{padding:0 5vw;border-color:#ffffff20;color:#edf1f7}${root} .top nav{color:#bac4d0}${root} .hero{padding:0;min-height:610px;position:relative;display:flex;align-items:end}${root} .hero>div:first-child{position:relative;z-index:2;padding:5vw;max-width:650px;background:linear-gradient(90deg,#111820f0,#11182099,transparent);color:#edf1f7}${root} .hero p{color:#c1ccd6}${root} .photo-panel{position:absolute;inset:0 0 0 32%}${root} .photo-panel img{height:100%;min-height:0;object-position:62% center}${root} .metrics,${root} .section{margin-left:5vw;margin-right:5vw}${root} .button{background:#73a9f5;color:#111820}
`,
    'web-ops-console': `${root} .top{background:#1c2721;color:#edf3df;border:0;padding:0 24px}${root} .top nav{color:#aabca6}${root} .hero{grid-template-columns:.65fr 1.35fr;min-height:330px;padding:32px 0}${root} .hero h1{font:600 clamp(32px,4vw,48px)/1.1 ui-monospace,monospace;letter-spacing:-.07em}${root} .photo-panel{height:300px}${root} .panel{background:#1c2721;color:#edf3df;border-color:#344237}${root} .metrics{background:#1c2721;border-color:#344237;color:#edf3df}${root} .metric{border-color:#344237}
`,
    'web-survey': `${root} .hero{grid-template-columns:1fr 1fr;padding:55px 0}${root} .hero>div:first-child{background:#fff;padding:28px;border-radius:22px;box-shadow:0 18px 40px #372e5c12}${root} .panel.visual{border-radius:50% 50% 18px 18px;background:#7c66c5;min-height:360px}${root} .orbit{width:220px;height:220px;border-color:#fff8;left:18%;top:18%}${root} .sun{background:#f6cf58;left:63%}${root} .hero .button{background:#7c66c5}${root} .section{background:#fff;border:0;padding:30px;border-radius:20px;margin-top:24px}
`,
    'web-game-2048': `${root}{background:#f6e7bd}${root} .top{border:0}${root} .hero{grid-template-columns:.8fr 1.2fr}${root} .hero h1{font:800 clamp(38px,6vw,72px)/.95 Inter,Arial,sans-serif;color:#263747;text-transform:uppercase}${root} .panel.visual{border:8px solid #263747;border-radius:28px;background:#f7c747;min-height:360px}${root} .orbit{border:0;border-radius:16px;background:#fff5db;width:88px;height:88px;left:15%;top:25%;box-shadow:100px 90px #e88e53,185px 5px #67aaa0}${root} .sun{width:68px;height:68px;border-radius:16px;left:65%;top:52%;background:#df6349;box-shadow:none}${root} .hero .button{background:#263747}
`,
    'research-industry': `${root} .report{grid-template-columns:1fr;gap:28px}${root} .reportmeta{display:grid;grid-template-columns:repeat(4,1fr)}${root} .reporthero{max-width:860px}${root} .thesis{background:#d8eeee}${root} .evidence-grid{grid-template-columns:1fr 1fr 1fr}${root} .evidence{border-top:3px solid ${accent}}
`,
    'research-policy': `${root} .report{grid-template-columns:280px 1fr;gap:4vw}${root} .reportmeta{background:#242b3a;color:#fbfcff;padding:20px;height:max-content}${root} .reportmeta .eyebrow,${root} .reportmeta small{color:#aab8d8}${root} .reporthero h1{font-family:Inter,Arial,sans-serif;font-weight:680}${root} .thesis{background:#dce3f3;border-left-width:6px}${root} .evidence-grid{grid-template-columns:1fr}
`,
    'research-literature': `${root} .shell{max-width:980px}${root} .report{display:block;padding-top:30px}${root} .reportmeta{display:flex;flex-direction:row;flex-wrap:wrap;gap:12px 24px;border-bottom:1px solid #c9baa4;padding-bottom:15px}${root} .reportmeta .meta-block{min-width:140px}${root} .reporthero h1{font-family:Georgia,serif;font-weight:400}${root} .evidence-grid{grid-template-columns:1fr;border:0;background:transparent}${root} .evidence{border-bottom:1px solid #d9cdbd;background:transparent;min-height:0}
`,
    'research-user': `${root} .report{grid-template-columns:180px 1fr}${root} .reportmeta{border-left:4px solid ${accent};padding-left:14px}${root} .reporthero{background:#f2ddd3;padding:24px;margin:0 -24px}${root} .chart-layout{grid-template-columns:1fr}${root} .evidence-grid{grid-template-columns:repeat(3,1fr)}${root} .evidence{border-radius:18px;margin:5px}
`,
    'research-market-entry': `${root} .report{grid-template-columns:1fr;gap:20px;padding-top:30px}${root} .reportmeta{display:grid;grid-template-columns:repeat(4,1fr);border-bottom:1px solid #c7d4c5;padding-bottom:15px}${root} .reporthero h1{font-family:Inter,Arial,sans-serif;font-weight:700}${root} .thesis{background:#dae9d8}${root} .chart-layout{grid-template-columns:.75fr 1.25fr}${root} .nextsteps{border-radius:24px;overflow:hidden}
`,
    'research-supply-chain': `${root} .mast{background:#332b29;color:#fff}${root} .mastin,${root} .brand,${root} .brand span{color:#f4ece8}${root} .report{grid-template-columns:1fr;gap:24px}${root} .reportmeta{display:none}${root} .reporthero{max-width:700px}${root} .evidence-grid{grid-template-columns:repeat(3,1fr)}${root} .evidence:nth-child(2){transform:translateY(22px)}${root} .thesis{background:#f1ded8}
`,
    'research-talent': `${root} .report{grid-template-columns:200px 1fr}${root} .reportmeta{background:#272a3a;color:#fcfcff;padding:18px}${root} .reportmeta .eyebrow,${root} .reportmeta small{color:#bdc6e8}${root} .reporthero h1{font-family:Inter,Arial,sans-serif;font-weight:700}${root} .evidence-grid{grid-template-columns:repeat(3,1fr)}${root} .evidence{border-top:2px solid ${accent}}
`,
    'academic-polish': `${root} .paper{display:block;max-width:920px}${root} .toc{display:none}${root} .paperhero h1{font-family:Georgia,serif;font-style:italic}${root} .questionbox{background:#f2dedd}${root} .method-table{border-radius:0 18px 18px 18px;overflow:hidden}
`,
    'academic-review': `${root} .paper{grid-template-columns:1fr 230px;gap:4vw}${root} .toc{grid-column:2;grid-row:1;position:sticky}${root} .paper article{grid-column:1;grid-row:1}${root} .paperhero h1{font-family:Inter,Arial,sans-serif;font-weight:700}${root} .logic div{border-radius:40px 8px 40px 8px}
`,
    'academic-data-analysis': `${root} .paper{grid-template-columns:1fr}${root} .toc{position:static;display:flex;flex-direction:row;flex-wrap:wrap;grid-row:1}${root} .paperhero{background:#372f27;color:#fffaf3;padding:30px;margin:0 -24px}${root} .paperhero>p,${root} .byline{color:#ddd0bd}${root} .method-table{border-radius:12px;overflow:hidden}
`,
    'academic-method': `${root} .paper{grid-template-columns:230px 1fr;gap:5vw}${root} .toc{border-right:1px solid #5c8f8633;padding-right:16px}${root} .paperhero h1{font-family:ui-monospace,monospace;font-size:clamp(31px,4vw,48px)}${root} .method-table>div{grid-template-columns:.9fr 1.2fr 1fr}
`,
    'academic-defense': `${root} .paper{max-width:1000px;display:block}${root} .toc{display:grid;grid-template-columns:repeat(5,1fr);margin-bottom:30px}${root} .toc a{display:grid;gap:5px}${root} .paperhero{background:#2f2a3c;color:#fff;padding:36px;margin:0 -32px}${root} .paperhero>p,${root} .byline{color:#d3cce4}${root} .logic div{background:#f0edf7;border-radius:50% 50% 8px 8px;text-align:center}
`,
    'academic-grant': `${root} .paper{grid-template-columns:1fr 200px;gap:3vw}${root} .toc{grid-column:2;grid-row:1;background:#e1ead5;padding:14px}${root} .paper article{grid-column:1;grid-row:1}${root} .paperhero h1{font-family:Georgia,serif;font-weight:400}${root} .questionbox{background:#e1ead5}${root} .callout{border-radius:24px 4px}
`,
    'academic-ethics': `${root} .paper{display:block;max-width:960px}${root} .toc{display:flex;flex-direction:row;flex-wrap:wrap;margin-bottom:24px}${root} .paperhero{border-left:6px solid ${accent};padding-left:20px}${root} .logic{grid-template-columns:repeat(5,1fr)}${root} .logic>i{display:none}${root} .logic div{border-radius:20px;text-align:center}
`,
    'docs-meeting': `${root} .doc{grid-template-columns:1fr}${root} .doc aside{display:none}${root} .doccover{background:#dcece2;padding:30px}${root} .docblock{border-left:1px solid #468d79;padding-left:16px}${root} .docblock .blocknum{font-size:18px}
`,
    'docs-report': `${root} .doc{grid-template-columns:220px 1fr;gap:4vw}${root} .doc aside{background:#392d29;color:#fffbf8;padding:18px}${root} .doc aside>a{color:#e1c7bc}${root} .doccover h1{font-family:ui-monospace,monospace;font-size:clamp(30px,4vw,48px)}${root} .docblock{background:#fff7f2;padding:18px;margin:12px 0}
`,
    'docs-summary': `${root} .doc{display:block;max-width:900px}${root} .doc aside{display:none}${root} .doccover{border-top:8px solid ${accent}}${root} .summary{background:#dceaf1;padding:26px}${root} .docblock{grid-template-columns:1fr 2fr;border:0;border-top:2px solid ${accent}}${root} .docblock .blocknum{font-size:25px}
`,
    'docs-notice': `${root} .doc{display:block;max-width:900px}${root} .doc aside{display:none}${root} .doccover{background:#f2e4c8;padding:28px}${root} .covermeta{background:#fffaf0;padding:12px}${root} .docblock{grid-template-columns:110px 1fr}${root} .docblock h2{font-family:Inter,Arial,sans-serif;font-weight:700}
`,
    'docs-api': `${root} .doc{grid-template-columns:1fr 235px;gap:4vw}${root} .doc aside{grid-column:2;grid-row:1;background:#292b40;color:#fbfbff;padding:16px}${root} .doc article{grid-column:1;grid-row:1}${root} .doccover h1{font-family:ui-monospace,monospace;font-size:clamp(31px,4vw,48px)}${root} .lineitem{font-family:ui-monospace,monospace;background:#eff0fb;padding:12px}
`,
    'docs-polish': `${root} .doc{grid-template-columns:1fr}${root} .doc aside{display:none}${root} .doccover{max-width:760px;margin:auto;border:0;text-align:center;padding:70px 0 45px}${root} .doccover h1{font-family:Georgia,serif;font-weight:400}${root} .summary{max-width:760px;margin:auto}${root} .docblock{border-top:1px dashed #c15d6f}
`,
    'docs-sop': `${root} .doc{grid-template-columns:200px 1fr}${root} .doc aside{background:#30362b;color:#fdfff8;padding:18px}${root} .doc aside>a{color:#d6dfc5}${root} .doccover{border-bottom:4px double ${accent}}${root} .questions label{padding:20px 10px;font-size:14px}${root} .questions input{width:19px;height:19px}
`,
  };
  const mobile = `@media(max-width:760px){
    body[data-case="research-policy"] .report,body[data-case="research-user"] .report,body[data-case="research-talent"] .report,body[data-case="docs-report"] .doc,body[data-case="docs-api"] .doc,body[data-case="docs-sop"] .doc{grid-template-columns:minmax(0,1fr)}
    body[data-case="research-policy"] .evidence-grid,body[data-case="research-user"] .evidence-grid,body[data-case="research-talent"] .evidence-grid{grid-template-columns:1fr}
    body[data-case="research-policy"] .reportmeta,body[data-case="research-talent"] .reportmeta{display:grid;grid-template-columns:1fr 1fr}
    body[data-case="research-user"] .reporthero{margin:0}
    body[data-case="academic-data-analysis"] .paperhero,body[data-case="academic-defense"] .paperhero{margin:0;padding:20px}
    body[data-case="docs-api"] .doc aside,body[data-case="docs-report"] .doc aside,body[data-case="docs-sop"] .doc aside{grid-column:auto;grid-row:auto}
    body[data-case="docs-api"] .doc article{grid-column:auto;grid-row:auto}
  }`;
  return `${base}${layouts[c.id] ?? ''}${mobile}`;
}

function pageShell(c, body, css = '', script = '') {
  const cfg = configs[c.skill];
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="${esc(c.lead)}"><title>${esc(c.title)} · ${esc(c.label)}</title><style>:root{--accent:${cfg.accent}}${commonCss}${css}${caseSkin(c)}</style></head><body data-case="${esc(c.id)}">${body}<script>${script}</script></body></html>`;
}

function website(c, index) {
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

function slidePage(c, index) {
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

function spreadsheet(c, index) {
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

function research(c, index) {
  const refs = c.refs ?? [
    ['待核验资料', 'https://www.iea.org/'],
    ['研究口径说明', 'https://www.worldbank.org/'],
  ];
  const evidence = refs
    .map(
      (r, i) =>
        `<a class="source" href="${esc(r[1])}" target="_blank" rel="noreferrer"><b>0${i + 1}</b><span>${esc(r[0])}<small>打开原始来源 ↗</small></span></a>`,
    )
    .join('');
  return pageShell(
    c,
    `<header class="mast"><div class="shell mastin"><a class="brand" href="#top">OPEN FIELD <span>/ RESEARCH NOTES</span></a><span>${String(index + 1).padStart(2, '0')}　·　${esc(c.label)}</span></div></header><main id="top" class="shell report"><aside class="reportmeta"><span class="eyebrow">RESEARCH MEMO / 2026.09</span><span class="badge">证据状态：待场景校验</span><div class="meta-block"><small>研究问题</small><b>${esc(c.title)}</b></div><div class="meta-block"><small>适用范围</small><b>${esc(c.lead)}</b></div><div class="meta-block"><small>读者</small><b>策略 / 产品 / 业务负责人</b></div><div class="meta-block"><small>资料截止</small><b>以链接页面发布日期为准</b></div></aside><article><div class="reporthero"><span class="eyebrow">THE SIGNAL / ${String(index + 1).padStart(2, '0')}</span><h1>${esc(c.title)}</h1><p>${esc(c.lead)}</p></div><div class="thesis"><span class="eyebrow">WORKING THESIS</span><strong>${esc(c.insight)}</strong><small>研究假设 · 不是行业事实结论</small></div><section class="memo-section"><div class="section-head"><div><span class="eyebrow">01 / WHAT WE KNOW</span><h2>把公开信息拆成可核对的主张</h2></div><span class="badge">原始来源优先</span></div><div class="evidence-grid">${c.steps.map((s, i) => `<div class="evidence"><span>0${i + 1} / ${i === 0 ? '信号' : i === 1 ? '比较' : '边界'}</span><h3>${esc(s)}</h3><p>${esc(c.metrics[i % 3][0])}　${esc(c.metrics[i % 3][1])}<br><small>该数值为页面结构示意，需回到来源核对定义。</small></p></div>`).join('')}</div></section><section class="memo-section"><div class="section-head"><div><span class="eyebrow">02 / EVIDENCE MAP</span><h2>趋势不是因果，来源也有边界</h2></div><span class="eyebrow">FACT → INTERPRETATION → OPEN QUESTION</span></div><div class="chart-layout"><div class="panel"><span class="eyebrow">COMPARATIVE INDEX / SCHEMATIC</span>${bars(c.chart, ['A', 'B', 'C', 'D', 'E', 'F'])}<small>仅为研究框架示意值，不代表公开统计序列。</small></div><div><div class="note"><b>可以判断</b><br>${esc(c.insight)}</div><div class="note" style="margin-top:12px"><b>仍需验证</b><br>地区、时间范围、样本口径和项目层面成本可能改变结论。</div></div></div></section><section class="memo-section sources"><div class="section-head"><div><span class="eyebrow">03 / SOURCE REGISTER</span><h2>回到资料本身</h2></div><p>引用前检查发布日期、单位与适用地区</p></div>${evidence}</section><section class="memo-section"><div class="section-head"><div><span class="eyebrow">NEXT / DECISION TEST</span><h2>建议的下一轮验证</h2></div></div><div class="nextsteps">${c.steps.map((s, i) => `<div><b>0${i + 1}</b><span>${esc(s)}</span><small>交付：口径表 + 可追踪证据 + 未决问题</small></div>`).join('')}</div></section></article></main><footer class="shell footer"><span>桌面研究样例 · 指标为结构示意 · 不构成投资或政策建议</span><a href="#top">返回页首 ↑</a></footer>`,
    `.mast{border-bottom:1px solid #d7ddd5}.mastin{height:64px;display:flex;align-items:center;justify-content:space-between;font:10px ui-monospace;color:#76847c}.brand{font:12px ui-monospace;letter-spacing:.12em;color:#23342d}.brand span{color:#819087}.report{display:grid;grid-template-columns:235px 1fr;gap:8vw;padding-top:54px}.reportmeta{padding-top:7px;display:flex;flex-direction:column;gap:20px}.badge{display:inline-flex;align-self:start;border:1px solid #cdd8ce;padding:5px 8px;color:#617368;font-size:10px}.meta-block{border-top:1px solid #d9ddd7;padding-top:9px;display:grid;gap:5px}.meta-block small{font-size:10px;color:#89938d}.meta-block b{font-size:12px;font-weight:550}.reporthero{padding-bottom:24px;border-bottom:1px solid #d9ddd7}.reporthero h1{font:500 clamp(35px,5vw,61px)/1.08 Georgia,"Songti SC",serif;letter-spacing:-.055em;max-width:17ch;margin:18px 0}.reporthero>p{font-size:15px;color:#67756d;max-width:58ch}.thesis{margin:22px 0 34px;padding:18px 20px;background:#e9eee8;display:grid;gap:8px;border-left:2px solid var(--accent)}.thesis strong{font:21px/1.35 Georgia,"Songti SC",serif;font-weight:500}.thesis small{color:#7d8981;font-size:10px}.memo-section{padding:0 0 35px;margin-bottom:30px;border-bottom:1px solid #d9ddd7}.memo-section h2{font:500 24px Georgia,"Songti SC",serif;margin:8px 0}.evidence-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:#dce1da;border:1px solid #dce1da}.evidence{background:#fff;padding:17px;min-height:182px}.evidence>span{font:9px ui-monospace;color:#89958c}.evidence h3{font:17px/1.35 Georgia,"Songti SC",serif;font-weight:500;margin:16px 0 10px}.evidence p{font-size:11px;color:#69756d}.evidence small{font-size:9px;color:#8d968e}.chart-layout{display:grid;grid-template-columns:1.2fr .8fr;gap:14px}.chart-layout .panel{padding:17px}.chart-layout .panel>small{font-size:9px;color:#909990}.chart-layout .note{min-height:76px}.source{display:flex;gap:18px;padding:13px 0;border-top:1px solid #dfe3dd;align-items:baseline}.source>b{font:11px ui-monospace;color:var(--accent)}.source span{font-size:13px}.source small{display:block;color:#8b958d;font-size:10px;margin-top:2px}.source:hover span{text-decoration:underline;text-decoration-color:var(--accent)}.nextsteps{display:grid;grid-template-columns:repeat(3,1fr);border:1px solid #dfe3dd}.nextsteps div{padding:14px;border-right:1px solid #dfe3dd;display:grid;gap:9px;align-content:start}.nextsteps div:last-child{border:0}.nextsteps b{font:10px ui-monospace;color:var(--accent)}.nextsteps span{font-size:12px}.nextsteps small{color:#89938c;font-size:9px}.report+.footer{border-top:1px solid #d9ddd7;margin-top:28px}.footer a{color:#51645a}@media(max-width:760px){.report{grid-template-columns:1fr;gap:30px;padding-top:34px}.reportmeta{display:grid;grid-template-columns:1fr 1fr;gap:12px}.reportmeta>.eyebrow,.reportmeta>.badge{grid-column:1/-1}.evidence-grid{grid-template-columns:1fr}.evidence{min-height:0}.chart-layout{grid-template-columns:1fr}.nextsteps{grid-template-columns:1fr}.nextsteps div{border-right:0;border-bottom:1px solid #dfe3dd}.mastin{gap:10px}.mastin>span{text-align:right}}`,
  );
}

function academic(c, index) {
  const sections = ['研究问题', '理论与假设', '设计选择', '测量与分析', '局限与伦理'];
  const refs = ['academic-method', 'academic-data-analysis'].includes(c.id)
    ? '<a href="https://pubmed.ncbi.nlm.nih.gov/25662947/" target="_blank" rel="noreferrer">Hemming et al. · stepped wedge trials ↗</a><a href="https://academic.oup.com/ije/article/46/1/348/2622842" target="_blank" rel="noreferrer">Bernal et al. · interrupted time series ↗</a>'
    : '<span>文献与量表需按研究主题另行检索、核对版本与适用人群。</span>';
  return pageShell(
    c,
    `<header class="paperbar"><div class="shell"><span>METHODS NOTE　/　${String(index + 1).padStart(2, '0')}</span><span>${esc(c.label)}　·　工作稿</span></div></header><main class="paper shell"><aside class="toc"><span class="eyebrow">ON THIS PAGE</span>${sections.map((s, i) => `<a href="#s${i}"><b>0${i + 1}</b>${s}</a>`).join('')}<div class="toc-note">研究设计示例<br>不含虚构研究结果</div></aside><article><header class="paperhero"><span class="eyebrow">RESEARCH DESIGN / ${esc(c.metrics[0][0])}　·　可检验草案</span><h1>${esc(c.title)}</h1><p>${esc(c.lead)}</p><div class="byline"><span>研究目标　${esc(c.insight)}</span><span>版本 0.3　/　${String(index + 1).padStart(2, '0')}</span></div></header><section id="s0"><span class="eyebrow">01　QUESTION</span><h2>把宽泛兴趣改写成可回答的问题</h2><div class="questionbox"><small>初始问题</small><strong>${esc(c.title)}</strong><small>研究目标</small><p>${esc(c.steps[0])}；明确分析单位、时间窗与情境边界，避免一次研究回答多个层次的问题。</p></div></section><section id="s1"><span class="eyebrow">02　LOGIC</span><h2>假设链要能被反驳</h2><div class="logic"><div><small>情境 / 暴露</small><b>${esc(c.steps[0])}</b></div><i>→</i><div><small>机制 / 中介</small><b>${esc(c.steps[1])}</b></div><i>→</i><div><small>结果 / 观察</small><b>${esc(c.steps[2])}</b></div></div><p class="muted">替代解释、选择偏差和测量误差要与主路径一起列出；假设不是结果。</p></section><section id="s2"><span class="eyebrow">03　DESIGN</span><h2>先由识别条件决定方法</h2><div class="method-table"><div class="thead"><span>选择条件</span><span>可考虑的设计</span><span>关键代价</span></div><div><span>干预分阶段上线</span><b>阶梯楔形集群试验</b><span>时间趋势与集群数要求</span></div><div><span>明确的外生时间点</span><b>中断时间序列</b><span>同期冲击与模型设定</span></div><div><span>处理组与对照组可比</span><b>差分中的差分</b><span>平行趋势假设</span></div></div><div class="callout">设计建议：${esc(c.insight)}</div></section><section id="s3"><span class="eyebrow">04　MEASUREMENT</span><h2>预先写下变量、时点与分析规则</h2><div class="metrics">${metricHtml(c.metrics)}</div>${list(c.steps, 'checklist')}</section><section id="s4"><span class="eyebrow">05　LIMITS & ETHICS</span><h2>诚实写出能说到哪里</h2><div class="split"><div><h3>解释边界</h3><p>${esc(c.lead)} 样本外推广、未测量混杂和缺失机制需要单独评估。</p></div><div><h3>伦理边界</h3><p>最小化收集个人信息；明确退出方式、数据保留期限与接触权限。</p></div></div><div class="refs">${refs}</div></section></article></main><footer class="shell">研究设计样稿 · 方法选择需结合实际样本与伦理审查</footer>`,
    `.paperbar{border-bottom:1px solid #dedbd5;background:#f9f8f4}.paperbar .shell{height:58px;display:flex;justify-content:space-between;align-items:center;font:10px ui-monospace;color:#7e7a86}.paper{display:grid;grid-template-columns:190px 1fr;gap:8vw;padding-top:44px}.toc{position:sticky;top:22px;align-self:start;display:flex;flex-direction:column;gap:12px}.toc a{display:flex;gap:12px;padding:8px 0;border-bottom:1px solid #e5e2dc;font-size:11px;color:#66616e}.toc a b{font:10px ui-monospace;color:#9b81c0}.toc-note{margin-top:18px;color:#938d98;font-size:10px;line-height:1.8}.paperhero{padding-bottom:22px;border-bottom:1px solid #dedbd5}.paperhero h1{font:500 clamp(36px,5vw,60px)/1.1 Georgia,"Songti SC",serif;letter-spacing:-.05em;margin:19px 0}.paperhero>p{font-size:15px;color:#6f6a75;max-width:55ch}.byline{display:flex;justify-content:space-between;border-top:1px solid #e6e3dd;margin-top:20px;padding-top:12px;font-size:10px;color:#87818c;gap:15px}.paper section{padding:29px 0;border-bottom:1px solid #dedbd5;scroll-margin-top:20px}.paper section h2{font:500 25px Georgia,"Songti SC",serif;margin:10px 0 18px}.questionbox{padding:18px;background:#eeebf2;border-left:2px solid #9879c7}.questionbox small{font:9px ui-monospace;color:#82768e}.questionbox strong{display:block;font:20px Georgia,"Songti SC",serif;margin:7px 0 12px}.questionbox p{font-size:12px;margin:0;color:#57535d}.logic{display:grid;grid-template-columns:1fr auto 1fr auto 1fr;align-items:center;gap:12px}.logic div{min-height:94px;padding:13px;border:1px solid #e1dde5;background:#fff;display:grid;align-content:space-between}.logic small{font-size:9px;color:#96909c}.logic b{font-size:12px}.logic>i{color:#9879c7}.muted{color:#8b8490;font-size:11px;margin-top:12px}.method-table{border:1px solid #e3dfe7;background:#fff}.method-table>div{display:grid;grid-template-columns:1fr 1.2fr 1fr;gap:12px;padding:12px;border-bottom:1px solid #ece9ef;font-size:11px}.method-table>div:last-child{border:0}.method-table .thead{background:#f2eff5;color:#837a8b;font-size:9px}.method-table b{font-weight:550}.callout{padding:12px 15px;background:#eeeaf2;margin-top:12px;color:#534a5f;font-size:12px}.checklist{padding-left:17px;color:#615d67}.checklist li{padding:5px 0}.refs{display:flex;gap:20px;flex-wrap:wrap;margin-top:18px}.refs a{font-size:10px;color:#76628f;border-bottom:1px solid #c8bdd5;padding-bottom:3px}.paper+footer{border-top:1px solid #ddd9e0;margin-top:30px;padding:19px 0;color:#8a8490;font-size:10px}@media(max-width:760px){.paper{grid-template-columns:1fr;gap:22px;padding-top:30px}.toc{position:static;display:grid;grid-template-columns:1fr 1fr;gap:6px}.toc>.eyebrow,.toc-note{grid-column:1/-1}.toc a{font-size:10px}.logic{grid-template-columns:1fr}.logic>i{transform:rotate(90deg);justify-self:center}.method-table>div{grid-template-columns:1fr;gap:4px}.byline{flex-direction:column}.paperbar .shell{gap:10px;font-size:9px}}`,
  );
}

function docs(c, index) {
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

function buildPage(c, index) {
  if (c.handcrafted) return;
  const html =
    c.skill === 'pptx'
      ? slidePage(c, index)
      : c.skill === 'excel'
        ? spreadsheet(c, index)
        : c.skill === 'website'
          ? website(c, index)
          : c.skill === 'research'
            ? research(c, index)
            : c.skill === 'academic'
              ? academic(c, index)
              : docs(c, index);
  writeFileSync(join(outDir, `${c.id}.html`), html);
}

/** Drop trailing sentence punctuation before a value is spliced into a longer sentence. */
const stripTail = value =>
  String(value ?? '')
    .trim()
    .replace(/[。．.！!?？]+$/u, '');

const promptFor = c => {
  const cfg = configs[c.skill];
  const common = `

请先查看相关技能说明，并按本例交付真实可用的成果，不要只生成概念摘要。场景：${stripTail(c.title)}。背景：${stripTail(c.lead)}

内容依据：${stripTail(c.insight)}。关键步骤：${c.steps.map(stripTail).join('；')}。需要呈现的指标：${c.metrics.map(([v, l]) => `${stripTail(l)}=${stripTail(v)}`).join('；')}。所有未提供的数字标记为演示假设，不得伪装成真实调研或用户数据。`;
  const recipes = {
    pptx: `使用 presentation-studio 制作 8–10 页可编辑 PPTX。按“问题—证据—解释—取舍—行动”组织叙事；${c.steps.map(stripTail).join('、')}。页面版式随信息类型变化，至少含一页可读数据图表、一页决策/行动清单和一页口径说明。每页标题表达结论，数字口径跨页一致，避免整套重复卡片模板。${common}`,
    excel: `使用 xlsx 交付可编辑工作簿：管理看板、结构化明细、口径与校验至少三张表。为${stripTail(c.title)}设计字段和数据验证，公式可追溯、汇总可勾稽、筛选排序有效；加入适合本场景的透视/趋势图与异常提示。不要把汇总结果硬编码，不要把所有内容塞进一张表。${common}`,
    website: `使用 frontend-design 技能制作可运行、响应式的网站原型。请按${stripTail(c.title)}选择合适的视觉方向，建立完整导航、清晰首屏、真实内容层级和至少两个可操作交互；适配手机，键盘可访问，避免套用通用 SaaS 模板。使用适合主题的原创视觉素材；表单说明数据不会被提交，示例信息明确标注。${common}`,
    research: `使用 deep-research 交付结构化研究简报。先定义问题、地区、时间范围和术语；优先引用官方/一手资料，逐条标注来源、发布日期、原文口径及其支持的主张。区分事实、推断和待验证假设，列出相反证据、资料截止日期、局限及下一轮验证计划。不得编造来源或把示意数字写成事实。${common}`,
    academic: `使用学术研究能力交付可审阅的研究设计/分析稿。写清研究问题、理论路径、可证伪假设、变量操作化、样本/方法选择理由、分析计划、替代解释、局限与伦理安排。引用必须可核验；无数据时不捏造结果，明确区分预注册计划与观察结果。${common}`,
    docs: `使用 docx 技能交付可直接协作的正式文档。采用清晰标题层级、摘要、背景、决定/方案、责任人和截止时间、风险、待确认问题与附录；关键事实、建议和假设分开呈现。提供目录或导航，表格易读，方便打印和后续编辑。${common}`,
  };
  return recipes[c.skill];
};

function englishPrompt(c) {
  const en = enScenario[c.id];
  const title = enTitles[c.id] ?? c.title;
  const brief = `Brief: ${stripTail(en.lead)}. Why it matters: ${stripTail(en.insight)}. Key steps: ${en.steps
    .map(stripTail)
    .join('; ')}. Indicators to present: ${en.metrics
    .map(([value, label]) => `${stripTail(label)} = ${stripTail(value)}`)
    .join(
      '; ',
    )}. Treat every figure that is not provided as an illustrative assumption rather than a measured result.`;
  const ask = `Create a polished, usable deliverable for \u201c${stripTail(title)}\u201d that keeps the audience, scope and milestones of the brief above.`;
  const endings = {
    pptx: 'Use presentation-studio to create an editable 8–10 slide deck with a clear problem → evidence → interpretation → trade-off → action narrative. Vary layouts by content, include a legible chart, a decision/action slide, and a definitions/source note. Use conclusion-led slide titles and consistent, auditable numbers.',
    excel:
      'Use xlsx to deliver an editable workbook with a decision dashboard, structured detail, and definitions/validation sheets. Include traceable formulas, reconciled totals, useful filters, scenario-specific charts, and visible anomaly checks. Do not hardcode summaries.',
    website:
      'Use frontend-design to build a responsive, runnable website prototype with a distinctive visual direction, clear navigation, meaningful content hierarchy, and at least two working interactions. Support mobile and keyboard use. Label example data and explain that prototype forms do not submit personal information.',
    research:
      'Use deep research to create an evidence-led brief. Define scope, geography, period, and terms. Prefer primary/official sources; attach publication dates and explain which claim each source supports. Separate verified facts, inference, and open questions; include counterevidence, cutoff date, limitations, and next validation steps. Never invent citations.',
    academic:
      'Create a reviewable academic research design or analysis. State the question, theoretical path, falsifiable hypotheses, operational measures, sampling/method rationale, analysis plan, alternative explanations, limitations, and ethics. Use verifiable references and never fabricate findings when data are absent.',
    docs: 'Use the document skill to deliver a polished, collaboration-ready document with clear heading hierarchy, summary, context, decision/proposal, owners and due dates, risks, open questions, and appendices. Separate facts, recommendations, and assumptions; make it easy to edit and print.',
  };
  return `${endings[c.skill]}\n\n${brief}\n\n${ask}`;
}

function updateCatalogues() {
  const skillOrder = ['pptx', 'excel', 'website', 'research', 'academic', 'docs'];
  catalog.actions = catalog.actions.filter(a => skillOrder.some(s => configs[s].action === a.id));
  for (const skill of skillOrder) {
    const cfg = configs[skill];
    const action = catalog.actions.find(a => a.id === cfg.action);
    if (!action) throw new Error(`Missing quick action ${cfg.action}`);
    action.prompts = manifest
      .filter(c => c.skill === skill)
      .map(c => ({ id: c.id, preview: `./case-previews/${c.id}.webp` }));
  }
  for (const language of ['zh', 'en']) {
    for (const actionId of Object.keys(i18n[language])) {
      if (!catalog.actions.some(a => a.id === actionId)) delete i18n[language][actionId];
    }
    for (const skill of skillOrder) {
      const cfg = configs[skill];
      const actionId = cfg.action;
      i18n[language][actionId] ??= { label: cfg[language] ?? cfg.en, prompts: {} };
      const actionInfo = i18n[language][actionId];
      actionInfo.prompts = {};
      for (const c of manifest.filter(item => item.skill === skill)) {
        actionInfo.prompts[c.id] = {
          label: language === 'zh' ? c.label : (enLabels[c.id] ?? c.label),
          description: language === 'zh' ? c.lead : `${stripTail(enScenario[c.id].description)}.`,
          prompt: language === 'zh' ? promptFor(c) : englishPrompt(c),
        };
      }
    }
  }
  writeFileSync(cataloguePath, `${JSON.stringify(catalog, null, 2)}\n`);
  writeFileSync(i18nPath, `${JSON.stringify(i18n, null, 2)}\n`);
}

if (manifest.length !== 72) throw new Error(`Expected exactly 72 cases, found ${manifest.length}`);
for (const skill of Object.keys(configs)) {
  const cases = manifest.filter(c => c.skill === skill);
  if (cases.length !== 12) throw new Error(`${skill} needs 12 cases, got ${cases.length}`);
  if (new Set(cases.map(c => c.id)).size !== 12) throw new Error(`${skill} has duplicate case ids`);
}
const missingEn = manifest.filter(c => !enScenario[c.id]).map(c => c.id);
if (missingEn.length) throw new Error(`Missing English scenario text: ${missingEn.join(', ')}`);
for (const [index, c] of manifest.entries()) buildPage(c, index % 12);
updateCatalogues();
console.log(`Updated ${manifest.length} cases across ${Object.keys(configs).length} quick skills.`);
