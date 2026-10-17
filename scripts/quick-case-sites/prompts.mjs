import { configs, enScenario } from './context.mjs';

export const enLabels = {
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

/** Drop trailing sentence punctuation before a value is spliced into a longer sentence. */
export const stripTail = value =>
  String(value ?? '')
    .trim()
    .replace(/[。．.！!?？]+$/u, '');

export const promptFor = c => {
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

export function englishPrompt(c) {
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
