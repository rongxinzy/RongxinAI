// ZhiYuan Agent · Figma Design System Synchronizer (FIG1-FIG11)
// Automated script running inside Figma to apply Quiet Studio v4.0 design standards.

const PANEL_WIDTH = 340;

figma.showUI(__html__, { width: PANEL_WIDTH, height: 520 });

function log(msg) {
  figma.ui.postMessage({ type: 'log', message: msg });
}

function updateStatus(msg, isError = false) {
  figma.ui.postMessage({ type: 'status', message: msg, isError });
}

async function ensureAllPagesLoaded() {
  for (const page of figma.root.children) {
    await page.loadAsync();
  }
}

async function findNode(id) {
  let node = await figma.getNodeByIdAsync(id);
  if (!node) {
    await ensureAllPagesLoaded();
    node = await figma.getNodeByIdAsync(id);
  }
  return node;
}

// -------------------------------------------------------------
// FIG1: Enable Auto Layout on Page 02 root frame (6:131 & 7:105)
// -------------------------------------------------------------
async function runFIG1() {
  log('▶ [FIG1] 开始重构首页主画板 Auto Layout (6:131 浅色 & 7:105 深色)...');
  let count = 0;
  const rootIds = ['6:131', '7:105'];

  for (const rootId of rootIds) {
    const root = await findNode(rootId);
    if (!root || root.type !== 'FRAME') {
      log(`  ⚠️ 未找到画板 ${rootId}，跳过`);
      continue;
    }

    // 启用水平 Auto Layout
    root.layoutMode = 'HORIZONTAL';
    root.paddingLeft = 8;
    root.paddingRight = 8;
    root.paddingTop = 8;
    root.paddingBottom = 8;
    root.itemSpacing = 0;
    root.counterAxisAlignItems = 'CENTER';

    // 调整主舞台与侧栏约束
    const stageId = rootId === '6:131' ? '6:252' : '7:130';
    const stage = await findNode(stageId);
    if (stage && stage.type === 'FRAME') {
      stage.cornerRadius = 12;
      try {
        stage.layoutGrow = 1;
        stage.layoutAlign = 'STRETCH';
      } catch (_e) {}
      log(`  ✓ 画板 ${rootId} 舞台 ${stageId} 已配置为 Fill container & 12px 圆角`);
    }

    count++;
    log(`  ✓ 画板 ${rootId} Auto Layout HORIZONTAL 配置完成 (padding=8, gap=0)`);
  }
  return count;
}

// -------------------------------------------------------------
// FIG2, FIG3, FIG4: Correct 1px centering offsets on 1012px main stage
// -------------------------------------------------------------
async function runFIG2_3_4() {
  log('▶ [FIG2-FIG4] 纠正 1012px 舞台 1px 偏心误差 (问候语, 说明, 输入岛, 快捷入口)...');
  let count = 0;
  const stagePairs = [
    { stageId: '6:252', greetingId: '6:255', descId: '6:256', composerId: '6:257', pillsId: '6:265' },
    { stageId: '7:130', greetingId: '7:133', descId: '7:134', composerId: '7:135', pillsId: '7:143' }
  ];

  for (const pair of stagePairs) {
    const stage = await findNode(pair.stageId);
    if (!stage || stage.type !== 'FRAME') continue;

    // 1. 问候语: 288px 宽，居中 x = (1012 - 288) / 2 = 362px (原 361px, 偏 1px)
    const greeting = await findNode(pair.greetingId);
    if (greeting && 'x' in greeting) {
      greeting.x = 362;
      if (greeting.type === 'TEXT') {
        try {
          await figma.loadFontAsync(greeting.fontName);
          greeting.textAlignHorizontal = 'CENTER';
        } catch (_e) {}
      }
      count++;
    }

    // 2. 说明副标题: 378px 宽，居中 x = (1012 - 378) / 2 = 317px (原 316px, 偏 1px)
    const desc = await findNode(pair.descId);
    if (desc && 'x' in desc) {
      desc.x = 317;
      if (desc.type === 'TEXT') {
        try {
          await figma.loadFontAsync(desc.fontName);
          desc.textAlignHorizontal = 'CENTER';
        } catch (_e) {}
      }
      count++;
    }

    // 3. 核心输入岛: 768px 宽，居中 x = (1012 - 768) / 2 = 122px (原 121px, 偏 1px)
    const composer = await findNode(pair.composerId);
    if (composer && 'x' in composer) {
      composer.x = 122;
      count++;
    }

    // 4. 快捷入口组: 690px 宽，居中 x = (1012 - 690) / 2 = 161px (原 160px, 偏 1px)
    const pills = await findNode(pair.pillsId);
    if (pills && 'x' in pills) {
      pills.x = 161;
      count++;
    }

    log(`  ✓ 舞台 ${pair.stageId} 问候(362px)、说明(317px)、输入岛(122px)、胶囊(161px) 对齐修正完成`);
  }
  return count;
}

// -------------------------------------------------------------
// FIG5: Align Composer bottom accessories (standardize 32px baseline)
// -------------------------------------------------------------
async function runFIG5() {
  log('▶ [FIG5] 对齐输入岛底部工具栏 Y 轴垂直基线 (消除 7px 锯齿)...');
  let count = 0;
  const composerPairs = [
    { composerId: '6:257', plusId: '6:259', wsId: '6:260', permId: '6:261', modelId: '6:262', sendId: '6:263' },
    { composerId: '7:135', plusId: '7:137', wsId: '7:138', permId: '7:139', modelId: '7:140', sendId: '7:141' }
  ];

  for (const pair of composerPairs) {
    const composer = await findNode(pair.composerId);
    if (!composer || composer.type !== 'FRAME') continue;

    // 统一垂直基线：文本类 y = 100, 发送按钮 (32x32) y = 94 (中心位于 110px，严格齐平)
    const items = [pair.plusId, pair.wsId, pair.permId, pair.modelId];
    for (const itemId of items) {
      const item = await findNode(itemId);
      if (item && 'y' in item) {
        item.y = 100;
        count++;
      }
    }
    const sendBtn = await findNode(pair.sendId);
    if (sendBtn && 'y' in sendBtn) {
      sendBtn.y = 94;
      count++;
    }

    log(`  ✓ 输入岛 ${pair.composerId} 底部配件基线已统合齐平 (text y=100, button y=94)`);
  }
  return count;
}

// -------------------------------------------------------------
// FIG6: Standardize Conversation stream reading column (896px max-w-4xl)
// -------------------------------------------------------------
async function runFIG6() {
  log('▶ [FIG6] 规范化会话阅读流至 896px 对称居中 (x = 58px)...');
  let count = 0;
  const streamPanel = await findNode('12:320');
  if (!streamPanel || streamPanel.type !== 'FRAME') {
    log('  ⚠️ 未找到会话面板 12:320');
    return 0;
  }

  // 1012px 舞台中，896px 阅读列对称坐标 x = (1012 - 896) / 2 = 58px
  const targetWidth = 896;
  const targetX = 58;

  // 续聊输入岛 12:334
  const composer = await findNode('12:334');
  if (composer && composer.type === 'FRAME') {
    composer.resize(targetWidth, composer.height);
    composer.x = targetX;

    // 调整内部右侧模型选择器与发送按钮位置
    const model = await findNode('12:338');
    if (model && 'x' in model) model.x = 730;
    const send = await findNode('12:339');
    if (send && 'x' in send) send.x = 852;

    count++;
    log(`  ✓ 续聊输入岛 12:334 已调整为 896px 宽，居中 x=58px`);
  }

  // 对齐助手回复及代码块起始线
  const leftAlignedNodes = ['12:328', '12:329', '12:330', '12:333'];
  for (const nid of leftAlignedNodes) {
    const node = await findNode(nid);
    if (node && 'x' in node) {
      node.x = targetX;
      count++;
    }
  }

  // 用户消息气泡 12:326 右对齐于 896px 边界 (58 + 896 - 285 = 669px)
  const userBubble = await findNode('12:326');
  if (userBubble && 'x' in userBubble) {
    userBubble.x = 669;
    count++;
    log(`  ✓ 用户消息气泡 12:326 已对齐至 896px 阅读列右侧边界`);
  }

  return count;
}

// -------------------------------------------------------------
// FIG7 & FIG8: Core component auto-layout constraints (Page 01)
// -------------------------------------------------------------
async function runFIG7_8() {
  log('▶ [FIG7-FIG8] 设置基础组件母版 Fill Container 与 Hug Contents 约束...');
  let count = 0;

  // FIG7: 侧栏导航行 4:34, 4:37, 4:40
  const navSymbols = ['4:34', '4:37', '4:40'];
  for (const sid of navSymbols) {
    const sym = await findNode(sid);
    if (sym && sym.type === 'COMPONENT') {
      sym.layoutMode = 'HORIZONTAL';
      sym.primaryAxisSizingMode = 'FIXED';
      sym.resize(244, 32);
      sym.paddingLeft = 10;
      sym.paddingRight = 10;
      sym.paddingTop = 6;
      sym.paddingBottom = 6;
      sym.itemSpacing = 8;
      sym.counterAxisAlignItems = 'CENTER';
      count++;
      log(`  ✓ 侧栏导航行母版 ${sid} 宽度设为 244px Auto Layout`);
    }
  }

  // FIG8: 通用按钮母版 4:60, 4:62, 4:64, 4:66, 4:68, 4:70, 4:72, 4:74
  const btnSymbols = ['4:60', '4:62', '4:64', '4:66', '4:68', '4:70', '4:72', '4:74'];
  for (const bid of btnSymbols) {
    const btn = await findNode(bid);
    if (btn && btn.type === 'COMPONENT') {
      btn.layoutMode = 'HORIZONTAL';
      btn.primaryAxisSizingMode = 'AUTO'; // Hug contents
      btn.paddingLeft = 12;
      btn.paddingRight = 12;
      btn.paddingTop = 6;
      btn.paddingBottom = 6;
      btn.itemSpacing = 8;
      btn.counterAxisAlignItems = 'CENTER';
      btn.primaryAxisAlignItems = 'CENTER';
      count++;
    }
  }
  log(`  ✓ ${btnSymbols.length} 个 32px 按钮母版已配置为 Auto Layout Hug contents (左右 px=12)`);

  // 快捷动作胶囊 6:124
  const pill = await findNode('6:124');
  if (pill && pill.type === 'COMPONENT') {
    pill.layoutMode = 'HORIZONTAL';
    pill.primaryAxisSizingMode = 'AUTO'; // Hug contents
    pill.paddingLeft = 12;
    pill.paddingRight = 12;
    pill.itemSpacing = 6;
    pill.counterAxisAlignItems = 'CENTER';
    count++;
    log(`  ✓ 快捷胶囊母版 6:124 已配置为 Auto Layout Hug contents`);
  }

  return count;
}

// -------------------------------------------------------------
// FIG9: Settings Center edge alignment (744px content and footer button)
// -------------------------------------------------------------
async function runFIG9() {
  log('▶ [FIG9] 设置中心右边缘齐平与底栏操作按钮对齐 (744px)...');
  let count = 0;

  // 设置行母版 9:100 设为 744px 撑满
  const rowSym = await findNode('9:100');
  if (rowSym && 'resize' in rowSym) {
    rowSym.resize(744, 44);
    count++;
    log(`  ✓ 设置行母版 9:100 已对齐至 744px`);
  }

  // 关闭按钮在设置底栏 9:217 (x=220, w=792) 中对齐 744px 内容列右边 (244+744=988px -> 988-220 = 768px, 宽28 -> x=740)
  const closeBtn = await findNode('9:218');
  if (closeBtn && 'x' in closeBtn) {
    closeBtn.x = 740;
    count++;
    log(`  ✓ 设置页脚关闭按钮 9:218 已对齐至内容区右边缘 (x=740)`);
  }

  return count;
}

// -------------------------------------------------------------
// FIG10: Modal System standardization (448px Form & Confirm + 512px resize)
// -------------------------------------------------------------
async function runFIG10() {
  log('▶ [FIG10] 弹窗规范标准化 (448px 基础母版体系与 16:1008 业务弹窗治理)...');
  let count = 0;

  // 治理业务弹窗 16:1008 (原 672px 缩小为标准 512px)
  const dialog = await findNode('16:1008');
  if (dialog && dialog.type === 'FRAME') {
    dialog.resize(512, dialog.height);
    
    // 调整表单滚动区与输入项宽度为 464px (512 - 48)
    const scrollArea = await findNode('16:1011');
    if (scrollArea && scrollArea.type === 'FRAME') {
      scrollArea.resize(464, scrollArea.height);
    }
    const inputIds = ['16:1013', '16:1016', '16:1019', '16:1023', '16:1030', '16:1037'];
    for (const iid of inputIds) {
      const inp = await findNode(iid);
      if (inp && 'resize' in inp) inp.resize(464, inp.height);
    }

    // 解决分钟单位溢出缺陷：计划输入框 340px，分钟框 72px，标签 432px
    const schedInput = await findNode('16:1027');
    if (schedInput && 'resize' in schedInput) schedInput.resize(340, schedInput.height);
    const minuteInput = await findNode('16:1032');
    if (minuteInput && 'x' in minuteInput) {
      minuteInput.x = 352;
      if ('resize' in minuteInput) minuteInput.resize(72, minuteInput.height);
    }
    const minuteUnit = await findNode('16:1034');
    if (minuteUnit && 'x' in minuteUnit) minuteUnit.x = 432;

    // 操作按钮对齐
    const btnCancel = await findNode('16:1040');
    if (btnCancel && 'x' in btnCancel) btnCancel.x = 228;
    const btnSubmit = await findNode('16:1041');
    if (btnSubmit && 'x' in btnSubmit) btnSubmit.x = 352;

    count++;
    log(`  ✓ 业务弹窗 16:1008 已重构为标准 512px，消除右侧分钟溢出`);
  }

  // 检查/建立 448px Form Dialog 母版 (在 Page 01)
  const page01 = figma.root.children.find(p => p.id === '4:33' || p.name.includes('基础组件'));
  if (page01) {
    await page01.loadAsync();
    const formBase = page01.findChild(n => n.name === 'Dialog / Form / 448');
    if (!formBase) {
      const comp = figma.createComponent();
      comp.name = 'Dialog / Form / 448';
      comp.resize(448, 280);
      comp.cornerRadius = 12;
      comp.layoutMode = 'VERTICAL';
      comp.paddingLeft = 24;
      comp.paddingRight = 24;
      comp.paddingTop = 24;
      comp.paddingBottom = 24;
      comp.itemSpacing = 16;
      comp.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
      comp.strokes = [{ type: 'SOLID', color: { r: 0.9, g: 0.92, b: 0.94 } }];
      comp.strokeWeight = 1;
      comp.x = 80;
      comp.y = 520;
      page01.appendChild(comp);
      count++;
      log(`  ✓ 创建标准 448px Form Dialog 母版 (Dialog / Form / 448)`);
    }

    const confirmBase = page01.findChild(n => n.name === 'Dialog / Confirm / 448');
    if (!confirmBase) {
      const comp = figma.createComponent();
      comp.name = 'Dialog / Confirm / 448';
      comp.resize(448, 200);
      comp.cornerRadius = 12;
      comp.layoutMode = 'VERTICAL';
      comp.paddingLeft = 24;
      comp.paddingRight = 24;
      comp.paddingTop = 24;
      comp.paddingBottom = 24;
      comp.itemSpacing = 16;
      comp.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
      comp.strokes = [{ type: 'SOLID', color: { r: 0.9, g: 0.92, b: 0.94 } }];
      comp.strokeWeight = 1;
      comp.x = 560;
      comp.y = 520;
      page01.appendChild(comp);
      count++;
      log(`  ✓ 创建标准 448px Destructive Confirm Dialog 母版 (Dialog / Confirm / 448)`);
    }
  }

  return count;
}

// -------------------------------------------------------------
// FIG11: Local Inference card grid auto-layout (Page 06)
// -------------------------------------------------------------
async function runFIG11() {
  log('▶ [FIG11] 本地推理卡片网格间距规范化 (gap=16)...');
  let count = 0;

  // 在模型市场 25:291 / 25:316 中对齐卡片网格
  const cardRow1 = ['25:370', '25:384'];
  const cardRow2 = ['25:398', '25:412'];

  for (const cid of cardRow1) {
    const card = await findNode(cid);
    if (card && 'y' in card) {
      card.y = 194;
      count++;
    }
  }
  for (const cid of cardRow2) {
    const card = await findNode(cid);
    if (card && 'y' in card) {
      card.y = 422; // 194 + 212 + 16 (gap=16) = 422px!
      count++;
    }
  }

  log(`  ✓ 本地推理卡片垂直间距严格规范为 gap=16 (y1=194, h=212, y2=422)`);
  return count;
}

// -------------------------------------------------------------
// Main execution dispatcher
// -------------------------------------------------------------
async function executeTask(task) {
  updateStatus('正在执行同步...', false);
  let totalModifications = 0;

  try {
    if (task === 'all' || task === 'fig1') totalModifications += await runFIG1();
    if (task === 'all' || task === 'fig2_3_4') totalModifications += await runFIG2_3_4();
    if (task === 'all' || task === 'fig5') totalModifications += await runFIG5();
    if (task === 'all' || task === 'fig6') totalModifications += await runFIG6();
    if (task === 'all' || task === 'fig7_8') totalModifications += await runFIG7_8();
    if (task === 'all' || task === 'fig9') totalModifications += await runFIG9();
    if (task === 'all' || task === 'fig10') totalModifications += await runFIG10();
    if (task === 'all' || task === 'fig11') totalModifications += await runFIG11();

    updateStatus(`同步完成！共执行 ${totalModifications} 处规范化修正`, false);
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    log(`❌ 执行异常: ${errorMsg}`);
    updateStatus(`执行失败: ${errorMsg}`, true);
  }
}

figma.ui.onmessage = async (msg) => {
  if (msg.type === 'resize') {
    figma.ui.resize(PANEL_WIDTH, Math.max(200, Math.min(900, Math.round(msg.height))));
    return;
  }
  if (msg.type === 'run-sync') {
    await executeTask(msg.task);
  }
};
