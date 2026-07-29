/**
 * html2pptx - 将HTML幻灯片转换为pptxgenjs幻灯片，支持精确定位元素
 *
 * 功能说明：
 *   这个模块使用 Playwright 浏览器引擎来解析HTML，提取所有元素的位置、样式和内容，
 *   然后使用 PptxGenJS 库将这些元素转换为 PowerPoint 幻灯片。
 *
 * 使用示例：
 *   const pptx = new pptxgen();
 *   pptx.layout = 'LAYOUT_16x9';  // 必须与HTML body的尺寸匹配
 *
 *   const { slide, placeholders } = await html2pptx('slide.html', pptx);
 *   slide.addChart(pptx.charts.LINE, data, placeholders[0]);
 *
 *   await pptx.writeFile('output.pptx');
 *
 * 主要功能：
 *   - 将HTML转换为PowerPoint，保持精确的元素定位
 *   - 支持文本、图片、形状和项目符号列表
 *   - 提取占位符元素（class="placeholder"）及其位置，用于后续添加图表等
 *   - 处理CSS渐变、边框和边距
 *
 * 验证功能：
 *   - 使用HTML body的宽高来设置视口尺寸
 *   - 如果HTML尺寸与演示文稿布局不匹配，抛出错误
 *   - 如果内容溢出body，抛出错误（包含溢出详情）
 *
 * 返回值：
 *   { slide, placeholders }
 *   - slide: 生成的幻灯片对象
 *   - placeholders: 占位符数组，每个元素包含 { id, x, y, w, h }
 */

// 引入依赖库
const { chromium } = require('playwright');  // 用于启动浏览器并解析HTML
const { browserLaunchOptions } = require('../browser-launch');
const path = require('path');                 // 路径处理工具
const sharp = require('sharp');               // 图片处理库（用于SVG转PNG）
const fs = require('fs');                     // 文件系统操作

// ============================================================================
// 日志工具：根据 isDebug 参数控制日志输出
// ============================================================================
let _isDebug = false;

/**
 * 设置调试模式
 * @param {boolean} debug - 是否启用调试模式
 */
function setDebugMode(debug) {
    _isDebug = debug;
}

/**
 * 日志工具对象
 * - log: 仅在 isDebug=true 时输出
 * - warn: 仅在 isDebug=true 时输出
 * - error: 始终输出
 */
const logger = {
    log: (...args) => {
        if (_isDebug) {
            console.log(...args);
        }
    },
    warn: (...args) => {
        if (_isDebug) {
            console.warn(...args);
        }
    },
    error: (...args) => {
        console.error(...args);
    }
};

// ============================================================================
// 单位转换常量
// ============================================================================
// 这些常量用于在不同单位之间进行转换
const PT_PER_PX = 0.75;      // 点（Point）到像素的转换比例：1像素 = 0.75点
const PX_PER_IN = 96;        // 像素到英寸的转换：96像素 = 1英寸（标准DPI）
const EMU_PER_IN = 914400;   // EMU（English Metric Units）到英寸：PowerPoint内部使用的单位

/**
 * 辅助函数：获取body尺寸并检查内容溢出
 *
 * 功能：
 *   1. 在浏览器中获取body元素的实际尺寸（width/height）
 *   2. 获取内容的滚动尺寸（scrollWidth/scrollHeight）
 *   3. 比较两者，如果内容超出body边界，记录错误
 *
 * 为什么需要检查溢出？
 *   - PowerPoint对内容位置有严格要求，内容不能超出幻灯片边界
 *   - 如果HTML内容溢出，转换后的PPTX文件可能会损坏或显示异常
 *
 * @param {Page} page - Playwright页面对象
 * @returns {Object} 包含body尺寸和错误信息的对象
 */
async function getBodyDimensions(page) {
  // 在浏览器环境中执行代码，获取body的尺寸信息
  const bodyDimensions = await page.evaluate(() => {
    const body = document.body;
    const style = window.getComputedStyle(body);  // 获取计算后的样式

    return {
      width: parseFloat(style.width),           // body的宽度（像素）
      height: parseFloat(style.height),         // body的高度（像素）
      scrollWidth: body.scrollWidth,            // 内容的实际宽度（包括溢出部分）
      scrollHeight: body.scrollHeight           // 内容的实际高度（包括溢出部分）
    };
  });

  const errors = [];

  // 计算溢出量（像素）
  // 减1是为了容错，避免因为像素舍入导致的微小差异
  const widthOverflowPx = Math.max(0, bodyDimensions.scrollWidth - bodyDimensions.width - 1);
  const heightOverflowPx = Math.max(0, bodyDimensions.scrollHeight - bodyDimensions.height - 1);

  // 转换为点（Point）单位，因为PowerPoint使用点作为单位
  const widthOverflowPt = widthOverflowPx * PT_PER_PX;
  const heightOverflowPt = heightOverflowPx * PT_PER_PX;

  // 如果有溢出，记录错误信息
  if (widthOverflowPt > 0 || heightOverflowPt > 0) {
    const directions = [];
    if (widthOverflowPt > 0) directions.push(`${widthOverflowPt.toFixed(1)}pt horizontally`);
    if (heightOverflowPt > 0) directions.push(`${heightOverflowPt.toFixed(1)}pt vertically`);

    // 特别提醒：底部需要留出0.5英寸的边距
    const reminder = heightOverflowPt > 0 ? ' (Remember: leave 0.5" margin at bottom of slide)' : '';
    errors.push(`HTML content overflows body by ${directions.join(' and ')}${reminder}`);
  }

  return { ...bodyDimensions, errors };
}

/**
 * 辅助函数：验证HTML尺寸是否与演示文稿布局匹配
 *
 * 功能：
 *   检查HTML body的尺寸是否与PowerPoint演示文稿的布局尺寸一致
 *   如果不一致，转换后的内容可能会出现位置偏移或缩放问题
 *
 * @param {Object} bodyDimensions - body的尺寸信息（从getBodyDimensions获取）
 * @param {Object} pres - PptxGenJS演示文稿对象
 * @returns {Array} 错误信息数组，如果没有错误则返回空数组
 */
function validateDimensions(bodyDimensions, pres) {
  const errors = [];

  // 将像素转换为英寸
  const widthInches = bodyDimensions.width / PX_PER_IN;
  const heightInches = bodyDimensions.height / PX_PER_IN;

  // 如果演示文稿定义了布局
  if (pres.presLayout) {
    // 将EMU单位转换为英寸（PowerPoint内部使用EMU）
    const layoutWidth = pres.presLayout.width / EMU_PER_IN;
    const layoutHeight = pres.presLayout.height / EMU_PER_IN;

    // 允许0.1英寸的误差（容错范围）
    // 如果差异超过0.1英寸，认为不匹配
    if (Math.abs(layoutWidth - widthInches) > 0.1 || Math.abs(layoutHeight - heightInches) > 0.1) {
      errors.push(
        `HTML dimensions (${widthInches.toFixed(1)}" × ${heightInches.toFixed(1)}") ` +
        `don't match presentation layout (${layoutWidth.toFixed(1)}" × ${layoutHeight.toFixed(1)}")`
      );
    }
  }
  return errors;
}

/**
 * 验证文本框位置：确保文本距离底部有足够的边距
 *
 * 功能：
 *   检查所有文本元素（段落、标题、列表）是否距离幻灯片底部太近
 *   PowerPoint要求文本内容距离底部至少0.5英寸，否则转换可能失败
 *
 * 为什么需要这个验证？
 *   - html2pptx转换过程中，如果文本太靠近底部，可能会被截断
 *   - 0.5英寸是PowerPoint的安全边距要求
 *
 * @param {Object} slideData - 提取的幻灯片数据
 * @param {Object} bodyDimensions - body的尺寸信息
 * @returns {Array} 错误信息数组
 */
function validateTextBoxPosition(slideData, bodyDimensions) {
  const errors = [];
  const slideHeightInches = bodyDimensions.height / PX_PER_IN;  // 幻灯片高度（英寸）
  const minBottomMargin = 0.5;  // 最小底部边距：0.5英寸

  // 遍历所有元素
  for (const el of slideData.elements) {
    // 只检查文本元素（段落、标题、列表）
    if (['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'list'].includes(el.type)) {
      const fontSize = el.style?.fontSize || 0;
      const bottomEdge = el.position.y + el.position.h;  // 文本框底部边缘位置
      const distanceFromBottom = slideHeightInches - bottomEdge;  // 距离底部的距离

      // 只检查字体大小大于12pt的文本（小字体可能不需要严格检查）
      if (fontSize > 12 && distanceFromBottom < minBottomMargin) {
        // 提取文本内容用于错误提示（只取前50个字符）
        const getText = () => {
          if (typeof el.text === 'string') return el.text;
          if (Array.isArray(el.text)) return el.text.find(t => t.text)?.text || '';
          if (Array.isArray(el.items)) return el.items.find(item => item.text)?.text || '';
          return '';
        };
        const textPrefix = getText().substring(0, 50) + (getText().length > 50 ? '...' : '');

        errors.push(
          `Text box "${textPrefix}" ends too close to bottom edge ` +
          `(${distanceFromBottom.toFixed(2)}" from bottom, minimum ${minBottomMargin}" required)`
        );
      }
    }
  }

  return errors;
}

/**
 * 辅助函数：为幻灯片添加背景
 *
 * 功能：
 *   根据提取的背景数据，为PowerPoint幻灯片设置背景
 *   支持两种背景类型：
 *   1. 图片背景：从HTML的background-image提取
 *   2. 纯色背景：从HTML的background-color提取
 *
 * @param {Object} slideData - 提取的幻灯片数据（包含background信息）
 * @param {Object} targetSlide - 目标幻灯片对象（PptxGenJS）
 * @param {string} tmpDir - 临时目录路径（未使用，可能是预留）
 */
async function addBackground(slideData, targetSlide, tmpDir) {
  // 处理图片背景
  if (slideData.background.type === 'image' && slideData.background.path) {
    // 移除file://协议前缀（如果有）
    let imagePath = slideData.background.path.startsWith('file://')
      ? slideData.background.path.replace('file://', '')
      : slideData.background.path;
    targetSlide.background = { path: imagePath };
  }
  // 处理纯色背景
  else if (slideData.background.type === 'color' && slideData.background.value) {
    targetSlide.background = { color: slideData.background.value };
  }
}

/**
 * 辅助函数：将提取的元素添加到幻灯片
 *
 * 重要：添加顺序很关键！
 *   1. 先添加形状（shapes）- 作为背景层
 *   2. 再添加图片和线条（images/lines）- 中间层
 *   3. 最后添加文本元素（text）- 作为前景层
 *
 * 为什么需要这个顺序？
 *   - PowerPoint使用Z-order（层叠顺序）来管理元素
 *   - 后添加的元素会显示在上层
 *   - 文本必须在最上层，否则可能被形状遮挡
 *
 * @param {Object} slideData - 提取的幻灯片数据（包含elements数组）
 * @param {Object} targetSlide - 目标幻灯片对象
 * @param {Object} pres - PptxGenJS演示文稿对象（用于访问ShapeType等常量）
 */
function addElements(slideData, targetSlide, pres) {
  // 将元素分类，确保正确的层叠顺序
  const shapes = [];        // 形状（背景层）
  const textElements = [];  // 文本元素（前景层）
  const otherElements = []; // 其他元素（图片、线条等，中间层）

  // 遍历所有元素，按类型分类
  for (const el of slideData.elements) {
    if (el.type === 'shape') {
      shapes.push(el);
    } else if (el.type === 'image' || el.type === 'line') {
      otherElements.push(el);
    } else {
      textElements.push(el);
    }
  }

  // ========================================================================
  // 第一步：添加形状（背景层）
  // ========================================================================
  for (const el of shapes) {
    try {
      // 只处理有填充色或边框的形状
      if (el.shape && (el.shape.fill || el.shape.line)) {
        // 构建形状选项对象
        const shapeOptions = {
          x: el.position.x,      // X坐标（英寸）
          y: el.position.y,      // Y坐标（英寸）
          w: el.position.w,      // 宽度（英寸）
          h: el.position.h,      // 高度（英寸）
          // 根据是否有圆角选择形状类型
          shape: el.shape.rectRadius > 0 ? pres.ShapeType.roundRect : pres.ShapeType.rect
        };

        // 设置填充色
        if (el.shape.fill) {
          shapeOptions.fill = { color: el.shape.fill };
          // 设置透明度（0-100，0表示完全不透明）
          if (el.shape.transparency != null) shapeOptions.fill.transparency = el.shape.transparency;
        }

        // 设置边框
        if (el.shape.line) shapeOptions.line = el.shape.line;

        // 设置圆角半径（如果有）
        if (el.shape.rectRadius > 0) shapeOptions.rectRadius = el.shape.rectRadius;

        // 设置阴影（如果有）
        if (el.shape.shadow) shapeOptions.shadow = el.shape.shadow;

        // 添加到幻灯片
        targetSlide.addShape(shapeOptions.shape || pres.ShapeType.rect, shapeOptions);
      }
    } catch (err) {
      logger.error(`Error adding shape:`, err.message);
    }
  }

  // ========================================================================
  // 第二步：添加其他元素（图片、线条等，中间层）
  // ========================================================================
  for (const el of otherElements) {
    try {
      // 处理图片元素
      if (el.type === 'image') {
        // 移除file://协议前缀（如果有）
        let imagePath = el.src.startsWith('file://') ? el.src.replace('file://', '') : el.src;
        const imageOptions = {
          path: imagePath,        // 图片文件路径
          x: el.position.x,       // X坐标
          y: el.position.y,       // Y坐标
          w: el.position.w,       // 宽度
          h: el.position.h        // 高度
        };

        // 添加透明度（如果有）
        // 注意：PptxGenJS 图片透明度使用 transparency 属性，范围 0-100
        if (el.transparency != null) {
          imageOptions.transparency = el.transparency;
        }

        targetSlide.addImage(imageOptions);
      }
      // 处理线条元素（用于非均匀边框）
      else if (el.type === 'line') {
        // 线条使用addShape方法，类型为line
        targetSlide.addShape(pres.ShapeType.line, {
          x: el.x1,              // 起点X坐标
          y: el.y1,              // 起点Y坐标
          w: el.x2 - el.x1,      // 宽度（终点X - 起点X）
          h: el.y2 - el.y1,      // 高度（终点Y - 起点Y）
          line: {
            color: el.color,     // 线条颜色
            width: el.width      // 线条宽度
          }
        });
      }
    } catch (err) {
      logger.error(`Error adding element type ${el.type}:`, err.message);
    }
  }

  // ========================================================================
  // 第三步：添加文本元素（前景层，最后添加确保在最上层）
  // ========================================================================
  for (const el of textElements) {
    try {
      // 处理列表元素（<ul>、<ol>）
      if (el.type === 'list') {
        const listOptions = {
          x: el.position.x,
          y: el.position.y,
          w: el.position.w,
          h: el.position.h,
          fontSize: el.style.fontSize,              // 字体大小
          fontFace: el.style.fontFace,              // 字体名称
          color: el.style.color,                    // 文字颜色
          align: el.style.align,                    // 对齐方式
          valign: 'top',                            // 垂直对齐（顶部）
          lineSpacing: el.style.lineSpacing,        // 行间距
          paraSpaceBefore: el.style.paraSpaceBefore, // 段落前间距
          paraSpaceAfter: el.style.paraSpaceAfter,   // 段落后间距
          margin: el.style.margin                   // 边距
        };
        if (el.style.margin) listOptions.margin = el.style.margin;
        // 添加列表文本（el.items是列表项数组）
        targetSlide.addText(el.items, listOptions);
      }
      // 处理普通文本元素（段落、标题等）
      else {
        // 判断是否为单行文本
        // 如果文本高度小于等于1.5倍行高，认为是单行
        const lineHeight = el.style.lineSpacing || el.style.fontSize * 1.2;
        const isSingleLine = el.position.h <= lineHeight * 1.5;

        let adjustedX = el.position.x;
        let adjustedW = el.position.w;

        // 单行文本宽度调整：增加宽度以补偿 PowerPoint 和浏览器的字体渲染差异
        // PowerPoint 的字体渲染通常比浏览器更宽，特别是中文字体
        if (isSingleLine) {
          // 检测是否包含中文字符（中文字符在 PowerPoint 中通常需要更多空间）
          const textContent = typeof el.text === 'string' ? el.text :
                             (Array.isArray(el.text) ? el.text.map(r => r.text || '').join('') : '');
          const hasChinese = /[\u4e00-\u9fff]/.test(textContent);

          // 中文文本增加 10%，英文文本增加 5%
          // 注意：中文标点符号（如《》、（）、：）在 PowerPoint 中通常比浏览器更宽
          const widthPercent = hasChinese ? 0.10 : 0.05;
          const widthIncrease = el.position.w * widthPercent;
          const align = el.style.align;

          if (align === 'center') {
            // 居中对齐：向两边扩展
            adjustedX = el.position.x - (widthIncrease / 2);
            adjustedW = el.position.w + widthIncrease;
          } else if (align === 'right') {
            // 右对齐：向左扩展
            adjustedX = el.position.x - widthIncrease;
            adjustedW = el.position.w + widthIncrease;
          } else {
            // 左对齐（默认）：向右扩展
            adjustedW = el.position.w + widthIncrease;
          }
        }

        // 构建文本选项对象
        const textOptions = {
          x: adjustedX,                          // 调整后的X坐标
          y: el.position.y,                     // Y坐标
          w: adjustedW,                          // 调整后的宽度
          h: el.position.h,                     // 高度
          fontSize: el.style.fontSize,           // 字体大小
          fontFace: el.style.fontFace,          // 字体名称
          color: el.style.color,                 // 文字颜色
          bold: el.style.bold,                   // 粗体
          italic: el.style.italic,               // 斜体
          underline: el.style.underline,        // 下划线
          valign: 'top',                        // 垂直对齐（顶部）
          lineSpacing: el.style.lineSpacing,     // 行间距
          paraSpaceBefore: el.style.paraSpaceBefore, // 段落前间距
          paraSpaceAfter: el.style.paraSpaceAfter,   // 段落后间距
          inset: 0  // 移除PowerPoint默认的内部边距（设为0）
        };

        // 设置可选样式属性
        if (el.style.align) textOptions.align = el.style.align;
        if (el.style.margin) textOptions.margin = el.style.margin;
        if (el.style.rotate !== undefined) textOptions.rotate = el.style.rotate;
        if (el.style.transparency !== null && el.style.transparency !== undefined) {
          textOptions.transparency = el.style.transparency;
        }

        // 验证文本内容
        const textToAdd = typeof el.text === 'string' ? el.text.trim() : el.text;
        if (textToAdd && (typeof textToAdd === 'string' ? textToAdd.length > 0 : true)) {
          // 确保颜色格式正确（必须是6位十六进制）
          if (textOptions.color && !/^[0-9A-F]{6}$/i.test(textOptions.color)) {
            logger.warn(`Invalid color format: ${textOptions.color}, using default black`);
            textOptions.color = '000000';  // 使用默认黑色
          }
          // 添加文本到幻灯片
          targetSlide.addText(textToAdd, textOptions);
        } else {
          logger.warn(`Skipping element type ${el.type}: empty text content`);
        }
      }
    } catch (err) {
      // 错误处理：记录详细的错误信息以便调试
      logger.error(`Error adding element type ${el.type}:`, err.message);
      logger.log(`Element details:`, {
        type: el.type,
        hasText: !!el.text,
        textType: typeof el.text,
        textLength: typeof el.text === 'string' ? el.text.length : 'N/A',
        position: el.position,
        color: el.style?.color
      });
    }
  }
}

/**
 * 核心函数：从HTML页面提取幻灯片数据
 *
 * 这是整个转换过程的核心函数，功能包括：
 *   1. 在浏览器环境中执行（使用page.evaluate）
 *   2. 遍历DOM树，提取所有元素
 *   3. 解析CSS样式，转换为PowerPoint格式
 *   4. 计算元素位置和尺寸
 *   5. 处理文本格式化（粗体、斜体、颜色等）
 *   6. 提取背景、形状、图片、列表等
 *
 * 为什么要在浏览器中执行？
 *   - 需要获取计算后的CSS样式（window.getComputedStyle）
 *   - 需要获取元素的实际渲染位置（getBoundingClientRect）
 *   - 这些信息在Node.js环境中无法直接获取
 *
 * @param {Page} page - Playwright页面对象
 * @returns {Promise<Object>} 包含background、elements、placeholders、errors的对象
 */
const extractSlideData = require('./extract-slide-data');

async function convertSvgToPng(page, tmpDir) {
  const PX_PER_IN = 96;  // 像素/英寸
  const pxToInch = (px) => px / PX_PER_IN;

  // 获取所有 SVG 元素的信息
  const svgInfoList = await page.evaluate(() => {
    const svgs = document.querySelectorAll('svg');
    return Array.from(svgs).map((svg, index) => {
      const rect = svg.getBoundingClientRect();
      const computed = window.getComputedStyle(svg);

      // 检查 SVG 是否可见（宽高大于0，且不是 display:none）
      if (rect.width <= 0 || rect.height <= 0 || computed.display === 'none') {
        return null;
      }

      return {
        index,
        position: {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height
        },
        opacity: parseFloat(computed.opacity)
      };
    }).filter(info => info !== null);
  });

  if (svgInfoList.length === 0) {
    return [];
  }

  logger.log(`📐 Found ${svgInfoList.length} SVG element(s), converting to PNG...`);

  const imageElements = [];
  const svgHandles = await page.$$('svg');

  for (const svgInfo of svgInfoList) {
    try {
      const svgHandle = svgHandles[svgInfo.index];
      if (!svgHandle) continue;

      // 生成唯一的文件名
      const timestamp = Date.now();
      const pngPath = path.join(tmpDir, `svg_${timestamp}_${svgInfo.index}.png`);

      // 截图 SVG 元素（透明背景）
      const screenshot = await svgHandle.screenshot({
        type: 'png',
        omitBackground: true  // 透明背景
      });

      // 保存截图到临时文件
      fs.writeFileSync(pngPath, screenshot);

      // 计算透明度（CSS opacity 转 PptxGenJS transparency）
      const transparency = svgInfo.opacity < 1 ? Math.round((1 - svgInfo.opacity) * 100) : null;

      // 创建图片元素
      const imageData = {
        type: 'image',
        src: pngPath,
        position: {
          x: pxToInch(svgInfo.position.left),
          y: pxToInch(svgInfo.position.top),
          w: pxToInch(svgInfo.position.width),
          h: pxToInch(svgInfo.position.height)
        }
      };

      // 添加透明度（如果有）
      if (transparency !== null) {
        imageData.transparency = transparency;
      }

      imageElements.push(imageData);
      logger.log(`   ✓ SVG #${svgInfo.index + 1}: ${Math.round(svgInfo.position.width)}x${Math.round(svgInfo.position.height)}px → ${pngPath}`);

    } catch (err) {
      logger.error(`   ✗ SVG #${svgInfo.index + 1}: Failed to convert - ${err.message}`);
    }
  }

  return imageElements;
}

/**
 * 主函数：将HTML文件转换为PowerPoint幻灯片
 *
 * 工作流程：
 *   1. 启动浏览器（使用Playwright）
 *   2. 加载HTML文件
 *   3. 获取body尺寸并检查溢出
 *   4. 提取所有元素数据（背景、文本、图片、形状等）
 *   5. 验证数据（尺寸匹配、位置检查等）
 *   6. 创建幻灯片并添加元素
 *   7. 返回幻灯片对象和占位符信息
 *
 * @param {string} htmlFile - HTML文件路径
 * @param {Object} pres - PptxGenJS演示文稿对象
 * @param {Object} options - 选项对象
 *   - tmpDir: 临时目录路径（默认：process.env.TMPDIR || '/tmp'）
 *   - slide: 目标幻灯片对象（如果提供，则使用该幻灯片；否则创建新幻灯片）
 *   - isDebug: 是否启用调试模式（默认：false）
 *              true: 打印所有日志（log, warn, error）
 *              false: 仅打印 error 日志
 * @returns {Promise<Object>} 包含slide和placeholders的对象
 */
async function html2pptx(htmlFile, pres, options = {}) {
  // 解构选项，设置默认值
  const {
    tmpDir = process.env.TMPDIR || '/tmp',  // 临时目录
    slide = null,                            // 目标幻灯片（null表示创建新幻灯片）
    isDebug = false                          // 调试模式
  } = options;

  // 设置调试模式
  setDebugMode(isDebug);

  try {
    // ========================================================================
    // 第一步：启动浏览器
    // ========================================================================
    // 配置启动选项
    const launchOptions = browserLaunchOptions(chromium, { env: { TMPDIR: tmpDir } });

    const browser = await chromium.launch(launchOptions);

    let bodyDimensions;  // body尺寸信息
    let slideData;       // 提取的幻灯片数据

    // 处理文件路径（支持绝对路径和相对路径）
    const filePath = path.isAbsolute(htmlFile) ? htmlFile : path.join(process.cwd(), htmlFile);

    try {
      // ========================================================================
      // 第二步：加载HTML并提取数据
      // ========================================================================
      const page = await browser.newPage();
      // 注意：浏览器控制台消息不记录，避免噪音

      // 加载HTML文件（使用file://协议）
      await page.goto(`file://${filePath}`);

      // 获取body尺寸并检查溢出
      bodyDimensions = await getBodyDimensions(page);

      // 设置视口大小（匹配body尺寸）
      await page.setViewportSize({
        width: Math.round(bodyDimensions.width),
        height: Math.round(bodyDimensions.height)
      });

      // ========================================================================
      // 第 2.5 步：将 SVG 元素转换为 PNG 图片
      // ========================================================================
      // SVG 无法直接导入 PowerPoint，需要先截图转换为 PNG
      const svgScreenshots = await convertSvgToPng(page, tmpDir);

      // 提取幻灯片数据（这是最核心的步骤）
      slideData = await extractSlideData(page);

      // 将 SVG 截图数据添加到 elements 中
      if (svgScreenshots && svgScreenshots.length > 0) {
        slideData.elements.push(...svgScreenshots);
      }

      // ========================================================================
      // 第 2.6 步：处理需要截图的图片（object-fit: cover）
      // ========================================================================
      // object-fit: cover 的图片在 PowerPoint 中无法直接裁剪，需要截图
      const coverImages = slideData.elements.filter(el => el.type === 'image' && el.needsScreenshot);
      if (coverImages.length > 0) {
        logger.log(`🖼️  Found ${coverImages.length} image(s) with object-fit: cover, taking screenshots...`);

        for (let i = 0; i < coverImages.length; i++) {
          const imgEl = coverImages[i];
          try {
            // 查找对应的 img 元素（通过 src 匹配）
            const imgHandle = await page.$(`img[src="${imgEl.src}"]`);
            if (!imgHandle) {
              logger.error(`   ✗ Image #${i + 1}: Could not find element`);
              continue;
            }

            // 生成唯一的文件名
            const timestamp = Date.now();
            const pngPath = path.join(tmpDir, `cover_img_${timestamp}_${i}.png`);

            // 截图该图片元素（会自动应用 object-fit: cover 的裁剪效果）
            const screenshot = await imgHandle.screenshot({
              type: 'png'
            });

            // 保存截图到临时文件
            fs.writeFileSync(pngPath, screenshot);

            // 更新图片源为截图文件
            imgEl.src = pngPath;
            delete imgEl.needsScreenshot;  // 移除标记

            logger.log(`   ✓ Image #${i + 1}: ${Math.round(imgEl.position.w * 96)}x${Math.round(imgEl.position.h * 96)}px → ${pngPath}`);
          } catch (err) {
            logger.error(`   ✗ Image #${i + 1}: Failed to screenshot - ${err.message}`);
          }
        }
      }
    } finally {
      // 确保浏览器被关闭（即使出错也要关闭）
      await browser.close();
    }

    // ========================================================================
    // 第三步：收集警告并输出（不会导致失败）
    // ========================================================================
    const allWarnings = [];
    if (slideData.warnings && slideData.warnings.length > 0) {
      allWarnings.push(...slideData.warnings);
    }

    // 输出警告信息（不影响转换）
    if (allWarnings.length > 0) {
      logger.warn(`⚠️  ${htmlFile}: ${allWarnings.length} warning(s):`);
      allWarnings.forEach((w, i) => logger.warn(`   ${i + 1}. ${w}`));
    }

    // ========================================================================
    // 第四步：收集溢出警告（不再作为错误阻止转换）
    // ========================================================================
    // 检查body溢出 - 改为警告，不阻止转换
    if (bodyDimensions.errors && bodyDimensions.errors.length > 0) {
      allWarnings.push(...bodyDimensions.errors);
    }

    // 检查尺寸匹配错误 - 改为警告，不阻止转换
    const dimensionErrors = validateDimensions(bodyDimensions, pres);
    if (dimensionErrors.length > 0) {
      // 将尺寸不匹配改为警告，而不是错误
      allWarnings.push(...dimensionErrors);
    }

    // 检查文本框位置错误 - 改为警告，不阻止转换
    const textBoxPositionErrors = validateTextBoxPosition(slideData, bodyDimensions);
    if (textBoxPositionErrors.length > 0) {
      // 将溢出警告记录下来，但不阻止转换
      allWarnings.push(...textBoxPositionErrors);
    }

    // 注意：slideData.errors 现在只包含严重错误（如果有的话）
    // 溢出错误也改为警告，不阻止转换
    if (slideData.errors && slideData.errors.length > 0) {
      allWarnings.push(...slideData.errors);
    }

    // ========================================================================
    // 第五步：不再因为溢出而抛出错误，允许转换继续
    // ========================================================================
    // 溢出内容可能显示不完整，但至少能生成幻灯片

    // ========================================================================
    // 第六步：创建幻灯片并添加元素
    // ========================================================================
    // 使用提供的幻灯片或创建新幻灯片
    const targetSlide = slide || pres.addSlide();

    // 添加背景
    await addBackground(slideData, targetSlide, tmpDir);

    // 添加所有元素（按正确顺序：形状->图片->文本）
    addElements(slideData, targetSlide, pres);

    // 返回结果
    return {
      slide: targetSlide,                           // 生成的幻灯片对象
      placeholders: slideData.placeholders,         // 占位符数组（用于后续添加图表等）
      warnings: allWarnings                         // 警告信息
    };
  } catch (error) {
    // 错误处理：如果错误消息不包含文件名，添加文件名前缀
    if (!error.message.startsWith(htmlFile)) {
      throw new Error(`${htmlFile}: ${error.message}`);
    }
    throw error;
  }
}

// 导出函数
module.exports = html2pptx;
