async function extractSlideData(page) {
  // 在浏览器环境中执行代码（这个函数内的代码在浏览器中运行，不在Node.js中）
  return await page.evaluate(() => {
    // ========================================================================
    // 单位转换常量（在浏览器环境中重新定义）
    // ========================================================================
    const PT_PER_PX = 0.75;  // 点/像素
    const PX_PER_IN = 96;    // 像素/英寸

    // ========================================================================
    // 字体处理：单字重字体列表
    // ========================================================================
    // 某些字体（如Impact）只有一种字重，不应该应用粗体
    // 如果强制应用粗体，PowerPoint会使用"假粗体"（faux bold），导致文字变宽
    const SINGLE_WEIGHT_FONTS = ['impact'];

    /**
     * 检查字体是否应该跳过粗体格式化
     * @param {string} fontFamily - 字体名称
     * @returns {boolean} 如果应该跳过粗体，返回true
     */
    const shouldSkipBold = (fontFamily) => {
      if (!fontFamily) return false;
      // 规范化字体名称：转小写、移除引号、取第一个字体（字体列表用逗号分隔）
      const normalizedFont = fontFamily.toLowerCase().replace(/['"]/g, '').split(',')[0].trim();
      return SINGLE_WEIGHT_FONTS.includes(normalizedFont);
    };

    // ========================================================================
    // 单位转换辅助函数
    // ========================================================================

    /**
     * 像素转英寸
     * @param {number} px - 像素值
     * @returns {number} 英寸值
     */
    const pxToInch = (px) => px / PX_PER_IN;

    /**
     * 像素字符串转点（Point）
     * @param {string} pxStr - 像素字符串（如"16px"）
     * @returns {number} 点值
     */
    const pxToPoints = (pxStr) => parseFloat(pxStr) * PT_PER_PX;

    /**
     * RGB/RGBA颜色字符串转十六进制
     * @param {string} rgbStr - RGB颜色字符串（如"rgb(255, 0, 0)"或"rgba(255, 0, 0, 0.5)"）
     * @returns {string} 十六进制颜色（如"FF0000"）
     */
    const rgbToHex = (rgbStr) => {
      // 处理透明背景，默认为白色
      if (rgbStr === 'rgba(0, 0, 0, 0)' || rgbStr === 'transparent') return 'FFFFFF';

      // 匹配rgb或rgba格式：rgb(255, 0, 0) 或 rgba(255, 0, 0, 0.5)
      const match = rgbStr.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      if (!match) return 'FFFFFF';

      // 提取RGB三个值，转换为十六进制，补零，转大写
      // 例如：rgb(255, 0, 0) -> ["255", "0", "0"] -> ["FF", "00", "00"] -> "FF0000"
      return match.slice(1).map(n => parseInt(n).toString(16).padStart(2, '0')).join('').toUpperCase();
    };

    /**
     * 从RGBA字符串提取透明度（alpha通道）
     * @param {string} rgbStr - RGBA颜色字符串
     * @returns {number|null} 透明度值（0-100，0表示完全不透明），如果无法提取则返回null
     */
    const extractAlpha = (rgbStr) => {
      const match = rgbStr.match(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/);
      if (!match || !match[4]) return null;
      const alpha = parseFloat(match[4]);  // alpha值范围：0-1
      // 转换为PowerPoint格式：0-100，0表示完全不透明，100表示完全透明
      return Math.round((1 - alpha) * 100);
    };

    /**
     * 应用CSS text-transform属性
     * @param {string} text - 原始文本
     * @param {string} textTransform - CSS text-transform值（uppercase/lowercase/capitalize/none）
     * @returns {string} 转换后的文本
     */
    const applyTextTransform = (text, textTransform) => {
      if (textTransform === 'uppercase') return text.toUpperCase();      // 全大写
      if (textTransform === 'lowercase') return text.toLowerCase();      // 全小写
      if (textTransform === 'capitalize') {
        // 首字母大写：匹配单词边界后的第一个字母
        return text.replace(/\b\w/g, c => c.toUpperCase());
      }
      return text;  // none或其他值，不转换
    };

    /**
     * 从CSS transform和writing-mode提取旋转角度
     *
     * PowerPoint旋转角度说明：
     *   - 90°：文本顺时针旋转90度（从上到下阅读，字母保持直立）
     *   - 270°：文本顺时针旋转270度（从下到上阅读，字母保持直立）
     *
     * @param {string} transform - CSS transform值（如"rotate(45deg)"或"matrix(...)"）
     * @param {string} writingMode - CSS writing-mode值（如"vertical-rl"）
     * @returns {number|null} 旋转角度（0-359），如果没有旋转则返回null
     */
    const getRotation = (transform, writingMode) => {
      let angle = 0;

      // 首先处理writing-mode（垂直文本方向）
      if (writingMode === 'vertical-rl') {
        // vertical-rl：文本从上到下阅读 = PowerPoint中的90度
        angle = 90;
      } else if (writingMode === 'vertical-lr') {
        // vertical-lr：文本从下到上阅读 = PowerPoint中的270度
        angle = 270;
      }

      // 然后添加transform中的旋转
      if (transform && transform !== 'none') {
        // 尝试匹配rotate()函数（如"rotate(45deg)"）
        const rotateMatch = transform.match(/rotate\((-?\d+(?:\.\d+)?)deg\)/);
        if (rotateMatch) {
          angle += parseFloat(rotateMatch[1]);
        } else {
          // 浏览器可能将transform计算为matrix格式
          // 需要从matrix中提取旋转角度
          const matrixMatch = transform.match(/matrix\(([^)]+)\)/);
          if (matrixMatch) {
            const values = matrixMatch[1].split(',').map(parseFloat);
            // CSS matrix格式：matrix(a, b, c, d, e, f)
            // 旋转角度 = atan2(b, a) * (180 / π)
            const matrixAngle = Math.atan2(values[1], values[0]) * (180 / Math.PI);
            angle += Math.round(matrixAngle);
          }
        }
      }

      // 规范化角度到0-359范围
      angle = angle % 360;
      if (angle < 0) angle += 360;

      // 如果没有旋转（角度为0），返回null
      return angle === 0 ? null : angle;
    };

    /**
     * 获取元素的位置和尺寸，考虑旋转
     *
     * 重要：PowerPoint和浏览器的旋转处理方式不同
     *   - 浏览器：先定义宽高，然后旋转（显示的是旋转后的尺寸）
     *   - PowerPoint：先定义宽高，然后旋转（需要的是旋转前的尺寸）
     *
     * 对于90°和270°旋转：
     *   - 浏览器显示的是旋转后的尺寸（垂直文本显示为高>宽）
     *   - PowerPoint需要的是旋转前的尺寸（宽>高，然后旋转）
     *   - 所以需要交换宽高
     *
     * @param {Element} el - DOM元素
     * @param {DOMRect} rect - 元素的边界矩形（getBoundingClientRect的结果）
     * @param {number|null} rotation - 旋转角度（0-359），null表示无旋转
     * @returns {Object} 包含x, y, w, h的对象（已考虑旋转）
     */
    const getPositionAndSize = (el, rect, rotation) => {
      // 如果没有旋转，直接返回rect的尺寸
      if (rotation === null) {
        return { x: rect.left, y: rect.top, w: rect.width, h: rect.height };
      }

      // 判断是否为垂直旋转（90°或270°）
      const isVertical = rotation === 90 || rotation === 270;

      if (isVertical) {
        // 垂直旋转：需要交换宽高
        // 浏览器显示的是旋转后的尺寸（高>宽）
        // PowerPoint需要的是旋转前的尺寸（宽>高，然后旋转）
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;

        return {
          x: centerX - rect.height / 2,  // 使用高度作为宽度
          y: centerY - rect.width / 2,    // 使用宽度作为高度
          w: rect.height,                 // 交换：浏览器的高度 = PowerPoint的宽度
          h: rect.width                   // 交换：浏览器的宽度 = PowerPoint的高度
        };
      }

      // 其他旋转角度：使用元素的offset尺寸（原始尺寸，未考虑旋转）
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      return {
        x: centerX - el.offsetWidth / 2,
        y: centerY - el.offsetHeight / 2,
        w: el.offsetWidth,
        h: el.offsetHeight
      };
    };

    /**
     * 解析CSS box-shadow属性，转换为PptxGenJS阴影格式
     *
     * CSS box-shadow格式：
     *   box-shadow: offsetX offsetY blur spread color [inset];
     *   例如：box-shadow: 2px 2px 8px 0px rgba(0, 0, 0, 0.3);
     *
     * 浏览器计算后的格式可能不同：
     *   "rgba(0, 0, 0, 0.3) 2px 2px 8px 0px [inset]"
     *
     * 重要限制：
     *   - PptxGenJS/PowerPoint不支持内阴影（inset shadows）
     *   - 如果检测到inset，返回null，避免文件损坏
     *
     * @param {string} boxShadow - CSS box-shadow值
     * @returns {Object|null} PptxGenJS阴影对象，如果无法解析或为内阴影则返回null
     */
    const parseBoxShadow = (boxShadow) => {
      if (!boxShadow || boxShadow === 'none') return null;

      // 检查是否为内阴影（inset）
      const insetMatch = boxShadow.match(/inset/);

      // 重要：PptxGenJS/PowerPoint不支持内阴影
      // 只处理外阴影，避免文件损坏
      if (insetMatch) return null;

      // 提取颜色（rgba或rgb）
      const colorMatch = boxShadow.match(/rgba?\([^)]+\)/);

      // 提取数值部分（支持px和pt单位）
      // 匹配格式：数字+单位（如"2px"、"8pt"）
      const parts = boxShadow.match(/([-\d.]+)(px|pt)/g);

      if (!parts || parts.length < 2) return null;

      const offsetX = parseFloat(parts[0]);  // X偏移
      const offsetY = parseFloat(parts[1]); // Y偏移
      const blur = parts.length > 2 ? parseFloat(parts[2]) : 0;  // 模糊半径

      // 从偏移量计算角度（度，0°=右，90°=下）
      let angle = 0;
      if (offsetX !== 0 || offsetY !== 0) {
        angle = Math.atan2(offsetY, offsetX) * (180 / Math.PI);
        if (angle < 0) angle += 360;  // 规范化到0-360
      }

      // 计算偏移距离（斜边长度，勾股定理）
      const offset = Math.sqrt(offsetX * offsetX + offsetY * offsetY) * PT_PER_PX;

      // 从rgba中提取透明度
      let opacity = 0.5;  // 默认透明度
      if (colorMatch) {
        const opacityMatch = colorMatch[0].match(/[\d.]+\)$/);
        if (opacityMatch) {
          opacity = parseFloat(opacityMatch[0].replace(')', ''));
        }
      }

      // 返回PptxGenJS阴影格式
      return {
        type: 'outer',                    // 外阴影
        angle: Math.round(angle),         // 角度（度）
        blur: blur * 0.75,                // 模糊半径（转换为点）
        color: colorMatch ? rgbToHex(colorMatch[0]) : '000000',  // 颜色（十六进制）
        offset: offset,                   // 偏移距离（点）
        opacity                           // 透明度（0-1）
      };
    };

    // ========================================================================
    // 警告收集器（必须在parseInlineFormatting之前定义，因为它会被使用）
    // 注意：这里收集的是警告而非错误，不会导致转换失败
    // ========================================================================
    const warnings = [];
    const errors = []; // 保留errors数组用于严重错误（如尺寸不匹配）

    /**
     * 解析内联格式化标签，转换为文本运行（text runs）
     *
     * 功能：
     *   将HTML中的内联格式化标签（<b>、<i>、<u>、<strong>、<em>、<span>）
     *   转换为PowerPoint的文本运行数组
     *
     * PowerPoint文本运行：
     *   一个文本运行（text run）是一段具有相同格式的文本
     *   例如："这是<b>粗体</b>文本"会被转换为两个运行：
     *     [{text: "这是", options: {}}, {text: "粗体", options: {bold: true}}, {text: "文本", options: {}}]
     *
     * @param {Element} element - DOM元素
     * @param {Object} baseOptions - 基础格式选项（会被子元素继承）
     * @param {Array} runs - 文本运行数组（累积结果）
     * @param {Function} baseTextTransform - 基础文本转换函数
     * @returns {Array} 文本运行数组
     */
    const parseInlineFormatting = (element, baseOptions = {}, runs = [], baseTextTransform = (x) => x) => {
      let prevNodeIsText = false;  // 跟踪上一个节点是否为文本节点（用于合并连续的文本）

      // 检查父元素是否为 PRE 或 CODE（需要保留空白字符）
      const isPreOrCode = element.tagName === 'PRE' || element.tagName === 'CODE' ||
                          element.closest('PRE') || element.closest('CODE');

      // 遍历元素的所有子节点
      element.childNodes.forEach((node) => {
        let textTransform = baseTextTransform;  // 文本转换函数

        // 判断是否为文本节点或换行符
        const isText = node.nodeType === Node.TEXT_NODE || node.tagName === 'BR';

        if (isText) {
          // 处理文本节点
          // <br>标签转换为换行符
          if (node.tagName === 'BR') {
            const prevRun = runs[runs.length - 1];
            if (prevNodeIsText && prevRun) {
              prevRun.text += '\n';
            } else {
              runs.push({ text: '\n', options: { ...baseOptions } });
            }
          } else {
            // 对于 PRE 和 CODE 标签内的文本，保留原始格式（包括空白字符和换行）
            // 对于其他文本，规范化空白字符
            const rawText = node.textContent;
            const text = isPreOrCode ? textTransform(rawText) : textTransform(rawText.replace(/\s+/g, ' '));
            const prevRun = runs[runs.length - 1];

            // 如果上一个节点也是文本节点，合并到同一个运行中（避免创建过多运行）
            if (prevNodeIsText && prevRun) {
              prevRun.text += text;
            } else {
              // 创建新的文本运行
              runs.push({ text, options: { ...baseOptions } });
            }
          }

        }
        // 处理元素节点（内联格式化标签）
        else if (node.nodeType === Node.ELEMENT_NODE && node.textContent.trim()) {
          const options = { ...baseOptions };  // 继承基础选项
          const computed = window.getComputedStyle(node);  // 获取计算后的样式

          // 处理 PRE 和 CODE 标签
          if (node.tagName === 'PRE' || node.tagName === 'CODE') {
            // 对于 PRE 和 CODE，确保使用等宽字体（如果未设置）
            if (!computed.fontFamily || !computed.fontFamily.includes('monospace') &&
                !computed.fontFamily.includes('Courier')) {
              options.fontFace = 'Courier New';
            } else {
              options.fontFace = computed.fontFamily.split(',')[0].replace(/['"]/g, '').trim();
            }

            // 处理字体大小（如果与父元素不同）
            if (computed.fontSize) options.fontSize = pxToPoints(computed.fontSize);

            // 处理颜色（如果不是默认黑色）
            if (computed.color && computed.color !== 'rgb(0, 0, 0)') {
              options.color = rgbToHex(computed.color);
              const transparency = extractAlpha(computed.color);
              if (transparency !== null) options.transparency = transparency;
            }

            // 递归处理子节点，保留空白字符
            parseInlineFormatting(node, options, runs, baseTextTransform);
          }
          // 处理内联元素（SPAN、B、STRONG、I、EM、U）
          else if (node.tagName === 'SPAN' || node.tagName === 'B' || node.tagName === 'STRONG' ||
              node.tagName === 'I' || node.tagName === 'EM' || node.tagName === 'U') {

            // 检查粗体：fontWeight为'bold'或数值>=600
            const isBold = computed.fontWeight === 'bold' || parseInt(computed.fontWeight) >= 600;
            if (isBold && !shouldSkipBold(computed.fontFamily)) options.bold = true;

            // 检查斜体
            if (computed.fontStyle === 'italic') options.italic = true;

            // 检查下划线
            if (computed.textDecoration && computed.textDecoration.includes('underline')) {
              options.underline = true;
            }

            // 处理颜色（如果不是默认黑色）
            if (computed.color && computed.color !== 'rgb(0, 0, 0)') {
              options.color = rgbToHex(computed.color);
              const transparency = extractAlpha(computed.color);
              if (transparency !== null) options.transparency = transparency;
            }

            // 处理字体大小（如果与父元素不同）
            if (computed.fontSize) options.fontSize = pxToPoints(computed.fontSize);

            // 应用text-transform（如果元素本身设置了）
            if (computed.textTransform && computed.textTransform !== 'none') {
              const transformStr = computed.textTransform;
              textTransform = (text) => applyTextTransform(text, transformStr);
            }

            // 验证：检查内联元素是否有margin（PowerPoint不支持）- 改为警告
            if (computed.marginLeft && parseFloat(computed.marginLeft) > 0) {
              warnings.push(`Inline element <${node.tagName.toLowerCase()}> has margin-left which is not supported in PowerPoint.`);
            }
            if (computed.marginRight && parseFloat(computed.marginRight) > 0) {
              warnings.push(`Inline element <${node.tagName.toLowerCase()}> has margin-right which is not supported in PowerPoint.`);
            }
            if (computed.marginTop && parseFloat(computed.marginTop) > 0) {
              warnings.push(`Inline element <${node.tagName.toLowerCase()}> has margin-top which is not supported in PowerPoint.`);
            }
            if (computed.marginBottom && parseFloat(computed.marginBottom) > 0) {
              warnings.push(`Inline element <${node.tagName.toLowerCase()}> has margin-bottom which is not supported in PowerPoint.`);
            }

            // 递归处理子节点（这会扁平化嵌套的span，转换为多个运行）
            parseInlineFormatting(node, options, runs, textTransform);
          }
        }

        prevNodeIsText = isText;  // 更新上一个节点的类型
      });

      // 清理：移除第一个运行的前导空格和最后一个运行的后缀空格
      // 这样可以避免格式化标签之间的空格被保留
      // 但对于 PRE 和 CODE 标签，保留所有空白字符
      if (runs.length > 0 && !isPreOrCode) {
        runs[0].text = runs[0].text.replace(/^\s+/, '');
        runs[runs.length - 1].text = runs[runs.length - 1].text.replace(/\s+$/, '');
      }

      // 过滤掉空文本的运行
      return runs.filter(r => r.text.length > 0);
    };

    // ========================================================================
    // 提取背景（从body元素）
    // ========================================================================
    const body = document.body;
    const bodyStyle = window.getComputedStyle(body);
    const bgImage = bodyStyle.backgroundImage;  // 背景图片
    const bgColor = bodyStyle.backgroundColor;  // 背景颜色

    // 验证：检查CSS渐变（不支持）- 改为警告，使用背景色代替
    if (bgImage && (bgImage.includes('linear-gradient') || bgImage.includes('radial-gradient'))) {
      warnings.push(
        'CSS gradients are not supported, using background color instead.'
      );
    }

    let background;
    // 如果有背景图片
    if (bgImage && bgImage !== 'none') {
      // 从url()中提取URL（支持url("...")或url(...)格式）
      const urlMatch = bgImage.match(/url\(["']?([^"')]+)["']?\)/);
      if (urlMatch) {
        background = {
          type: 'image',
          path: urlMatch[1]  // 图片路径
        };
      } else {
        // 如果无法提取URL，使用背景颜色
        background = {
          type: 'color',
          value: rgbToHex(bgColor)
        };
      }
    } else {
      // 没有背景图片，使用背景颜色
      background = {
        type: 'color',
        value: rgbToHex(bgColor)
      };
    }

    // ========================================================================
    // 处理所有元素：遍历DOM树，提取元素信息
    // ========================================================================
    const elements = [];        // 提取的元素数组
    const placeholders = [];    // 占位符数组（用于后续添加图表等）
    const textTags = ['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'PRE', 'CODE', 'SPAN'];  // 文本标签列表
    const processed = new Set();  // 已处理的元素集合（避免重复处理）

    // 遍历所有元素（使用querySelectorAll('*')获取所有元素）
    document.querySelectorAll('*').forEach((el) => {
      // 如果已经处理过，跳过（避免重复处理）
      if (processed.has(el)) return;

      // Validate text elements don't have backgrounds, borders, or shadows
      // Note: We check the element's own style, not inherited styles
      if (textTags.includes(el.tagName)) {
        const computed = window.getComputedStyle(el);
        // Check if background is explicitly set on this element (not inherited)
        const bgColor = computed.backgroundColor;
        const hasBg = bgColor && bgColor !== 'rgba(0, 0, 0, 0)' && bgColor !== 'transparent' &&
                      computed.backgroundImage !== 'none';
        // Check if border is explicitly set (not from parent)
        const hasBorder = (computed.borderWidth && parseFloat(computed.borderWidth) > 0) ||
                          (computed.borderTopWidth && parseFloat(computed.borderTopWidth) > 0) ||
                          (computed.borderRightWidth && parseFloat(computed.borderRightWidth) > 0) ||
                          (computed.borderBottomWidth && parseFloat(computed.borderBottomWidth) > 0) ||
                          (computed.borderLeftWidth && parseFloat(computed.borderLeftWidth) > 0);
        const hasShadow = computed.boxShadow && computed.boxShadow !== 'none';

        // Only skip if the element itself has these styles (not inherited from parent)
        // Check if background is actually set on this element vs inherited
        const style = el.style;
        const hasExplicitBg = style.backgroundColor || style.backgroundImage;
        const hasExplicitBorder = style.borderWidth || style.borderTopWidth || style.borderRightWidth ||
                                  style.borderBottomWidth || style.borderLeftWidth;
        const hasExplicitShadow = style.boxShadow;

        if ((hasBg && hasExplicitBg) || (hasBorder && hasExplicitBorder) || (hasShadow && hasExplicitShadow)) {
          // 改为警告，继续处理元素（忽略背景/边框/阴影）
          warnings.push(
            `Text element <${el.tagName.toLowerCase()}> has ${hasBg && hasExplicitBg ? 'background' : hasBorder && hasExplicitBorder ? 'border' : 'shadow'} which will be ignored.`
          );
          // 不再return，继续处理文本内容
        }
      }

      // Extract placeholder elements (for charts, etc.)
      // 注意：el.className 对于 SVG 元素是 SVGAnimatedString，不能直接用 includes
      const classNameStr = typeof el.className === 'string' ? el.className :
                          (el.className && el.className.baseVal ? el.className.baseVal : '');
      if (classNameStr && classNameStr.includes('placeholder')) {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) {
          warnings.push(
            `Placeholder "${el.id || 'unnamed'}" has ${rect.width === 0 ? 'width: 0' : 'height: 0'}, skipping.`
          );
        } else {
          placeholders.push({
            id: el.id || `placeholder-${placeholders.length}`,
            x: pxToInch(rect.left),
            y: pxToInch(rect.top),
            w: pxToInch(rect.width),
            h: pxToInch(rect.height)
          });
        }
        processed.add(el);
        return;
      }

      // Extract images
      if (el.tagName === 'IMG') {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          const computed = window.getComputedStyle(el);
          // 提取 opacity（CSS opacity 范围 0-1，PptxGenJS transparency 范围 0-100）
          const opacity = parseFloat(computed.opacity);
          // 转换为 transparency：opacity 1 = transparency 0，opacity 0 = transparency 100
          const transparency = opacity < 1 ? Math.round((1 - opacity) * 100) : null;

          // 处理 object-fit: contain/cover 的情况
          // 当使用 object-fit 时，图片的实际显示尺寸和元素的边界框尺寸不同
          const objectFit = computed.objectFit;
          let imgX = rect.left;
          let imgY = rect.top;
          let imgW = rect.width;
          let imgH = rect.height;
          let needsScreenshot = false;  // 是否需要截图（用于 cover 模式）

          if (objectFit === 'contain' || objectFit === 'cover') {
            // 获取图片的原始尺寸
            const naturalW = el.naturalWidth;
            const naturalH = el.naturalHeight;

            if (naturalW > 0 && naturalH > 0) {
              const containerW = rect.width;
              const containerH = rect.height;
              const containerRatio = containerW / containerH;
              const imageRatio = naturalW / naturalH;

              if (objectFit === 'contain') {
                // contain：图片完整显示在容器内，可能有空白
                if (imageRatio > containerRatio) {
                  // 图片更宽：宽度撑满，高度按比例缩小
                  imgW = containerW;
                  imgH = containerW / imageRatio;
                  imgX = rect.left;
                  imgY = rect.top + (containerH - imgH) / 2;  // 垂直居中
                } else {
                  // 图片更高：高度撑满，宽度按比例缩小
                  imgH = containerH;
                  imgW = containerH * imageRatio;
                  imgX = rect.left + (containerW - imgW) / 2;  // 水平居中
                  imgY = rect.top;
                }
              } else if (objectFit === 'cover') {
                // cover：图片覆盖整个容器，会被裁剪
                // PowerPoint 不直接支持裁剪，需要通过截图来实现
                // 标记需要截图，保持容器尺寸
                needsScreenshot = true;
                imgX = rect.left;
                imgY = rect.top;
                imgW = containerW;
                imgH = containerH;
              }
            }
          }

          const imageData = {
            type: 'image',
            src: el.src,
            position: {
              x: pxToInch(imgX),
              y: pxToInch(imgY),
              w: pxToInch(imgW),
              h: pxToInch(imgH)
            },
            needsScreenshot: needsScreenshot  // 标记是否需要截图
          };

          // 只有当透明度不是完全不透明时才添加
          if (transparency !== null) {
            imageData.transparency = transparency;
          }

          elements.push(imageData);
          processed.add(el);
          return;
        }
      }

      // Extract DIVs with backgrounds/borders as shapes
      const isContainer = el.tagName === 'DIV' && !textTags.includes(el.tagName);
      if (isContainer) {
        const computed = window.getComputedStyle(el);
        const hasBg = computed.backgroundColor && computed.backgroundColor !== 'rgba(0, 0, 0, 0)';

        // Validate: Check for unwrapped text content in DIV - 改为警告
        for (const node of el.childNodes) {
          if (node.nodeType === Node.TEXT_NODE) {
            const text = node.textContent.trim();
            if (text) {
              warnings.push(
                `DIV contains unwrapped text "${text.substring(0, 30)}${text.length > 30 ? '...' : ''}" which will be ignored.`
              );
            }
          }
        }

        // Check for background images on shapes - 改为警告，跳过背景图片但继续处理
        const bgImage = computed.backgroundImage;
        if (bgImage && bgImage !== 'none') {
          // 检查是否是渐变
          if (bgImage.includes('linear-gradient') || bgImage.includes('radial-gradient')) {
            warnings.push('DIV has CSS gradient which will be ignored.');
          } else {
            warnings.push('DIV has background-image which will be ignored.');
          }
          // 不再return，继续处理其他样式（如背景色、边框）
        }

        // Check for borders - both uniform and partial
        const borderTop = computed.borderTopWidth;
        const borderRight = computed.borderRightWidth;
        const borderBottom = computed.borderBottomWidth;
        const borderLeft = computed.borderLeftWidth;
        const borders = [borderTop, borderRight, borderBottom, borderLeft].map(b => parseFloat(b) || 0);
        const hasBorder = borders.some(b => b > 0);
        const hasUniformBorder = hasBorder && borders.every(b => b === borders[0]);
        const borderLines = [];

        if (hasBorder && !hasUniformBorder) {
          const rect = el.getBoundingClientRect();
          const x = pxToInch(rect.left);
          const y = pxToInch(rect.top);
          const w = pxToInch(rect.width);
          const h = pxToInch(rect.height);

          // Collect lines to add after shape (inset by half the line width to center on edge)
          if (parseFloat(borderTop) > 0) {
            const widthPt = pxToPoints(borderTop);
            const inset = (widthPt / 72) / 2; // Convert points to inches, then half
            borderLines.push({
              type: 'line',
              x1: x, y1: y + inset, x2: x + w, y2: y + inset,
              width: widthPt,
              color: rgbToHex(computed.borderTopColor)
            });
          }
          if (parseFloat(borderRight) > 0) {
            const widthPt = pxToPoints(borderRight);
            const inset = (widthPt / 72) / 2;
            borderLines.push({
              type: 'line',
              x1: x + w - inset, y1: y, x2: x + w - inset, y2: y + h,
              width: widthPt,
              color: rgbToHex(computed.borderRightColor)
            });
          }
          if (parseFloat(borderBottom) > 0) {
            const widthPt = pxToPoints(borderBottom);
            const inset = (widthPt / 72) / 2;
            borderLines.push({
              type: 'line',
              x1: x, y1: y + h - inset, x2: x + w, y2: y + h - inset,
              width: widthPt,
              color: rgbToHex(computed.borderBottomColor)
            });
          }
          if (parseFloat(borderLeft) > 0) {
            const widthPt = pxToPoints(borderLeft);
            const inset = (widthPt / 72) / 2;
            borderLines.push({
              type: 'line',
              x1: x + inset, y1: y, x2: x + inset, y2: y + h,
              width: widthPt,
              color: rgbToHex(computed.borderLeftColor)
            });
          }
        }

        if (hasBg || hasBorder) {
          const rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            const shadow = parseBoxShadow(computed.boxShadow);

            // Only add shape if there's background or uniform border
            if (hasBg || hasUniformBorder) {
              elements.push({
                type: 'shape',
                text: '',  // Shape only - child text elements render on top
                position: {
                  x: pxToInch(rect.left),
                  y: pxToInch(rect.top),
                  w: pxToInch(rect.width),
                  h: pxToInch(rect.height)
                },
                shape: {
                  fill: hasBg ? rgbToHex(computed.backgroundColor) : null,
                  transparency: hasBg ? extractAlpha(computed.backgroundColor) : null,
                  line: hasUniformBorder ? {
                    color: rgbToHex(computed.borderColor),
                    width: pxToPoints(computed.borderWidth)
                  } : null,
                  // Convert border-radius to rectRadius (in inches)
                  // % values: 50%+ = circle (1), <50% = percentage of min dimension
                  // pt values: divide by 72 (72pt = 1 inch)
                  // px values: divide by 96 (96px = 1 inch)
                  rectRadius: (() => {
                    const radius = computed.borderRadius;
                    const radiusValue = parseFloat(radius);
                    if (radiusValue === 0) return 0;

                    if (radius.includes('%')) {
                      if (radiusValue >= 50) return 1;
                      // Calculate percentage of smaller dimension
                      const minDim = Math.min(rect.width, rect.height);
                      return (radiusValue / 100) * pxToInch(minDim);
                    }

                    if (radius.includes('pt')) return radiusValue / 72;
                    return radiusValue / PX_PER_IN;
                  })(),
                  shadow: shadow
                }
              });
            }

            // Add partial border lines
            elements.push(...borderLines);

            processed.add(el);
            return;
          }
        }
      }

      // Extract bullet lists as single text block
      if (el.tagName === 'UL' || el.tagName === 'OL') {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;

        const liElements = Array.from(el.querySelectorAll('li'));
        const items = [];
        const ulComputed = window.getComputedStyle(el);
        const ulPaddingLeftPt = pxToPoints(ulComputed.paddingLeft);

        // Split: margin-left for bullet position, indent for text position
        // margin-left + indent = ul padding-left
        const marginLeft = ulPaddingLeftPt * 0.5;
        const textIndent = ulPaddingLeftPt * 0.5;

        liElements.forEach((li, idx) => {
          const isLast = idx === liElements.length - 1;
          const runs = parseInlineFormatting(li, { breakLine: false });
          // Clean manual bullets from first run
          if (runs.length > 0) {
            runs[0].text = runs[0].text.replace(/^[•\-\*▪▸]\s*/, '');
            runs[0].options.bullet = { indent: textIndent };
          }
          // Set breakLine on last run
          if (runs.length > 0 && !isLast) {
            runs[runs.length - 1].options.breakLine = true;
          }
          items.push(...runs);
        });

        const computed = window.getComputedStyle(liElements[0] || el);

        elements.push({
          type: 'list',
          items: items,
          position: {
            x: pxToInch(rect.left),
            y: pxToInch(rect.top),
            w: pxToInch(rect.width),
            h: pxToInch(rect.height)
          },
          style: {
            fontSize: pxToPoints(computed.fontSize),
            fontFace: computed.fontFamily.split(',')[0].replace(/['"]/g, '').trim(),
            color: rgbToHex(computed.color),
            transparency: extractAlpha(computed.color),
            align: computed.textAlign === 'start' ? 'left' : computed.textAlign,
            lineSpacing: computed.lineHeight && computed.lineHeight !== 'normal' ? pxToPoints(computed.lineHeight) : null,
            paraSpaceBefore: 0,
            paraSpaceAfter: pxToPoints(computed.marginBottom),
            // PptxGenJS margin array is [left, right, bottom, top]
            margin: [marginLeft, 0, 0, 0]
          }
        });

        // 将 UL/OL 及其所有子元素添加到 processed 集合，防止重复提取
        // 这包括 li 元素以及 li 中的 span、b、i 等内联元素
        liElements.forEach(li => {
          processed.add(li);
          // 标记 li 中的所有子元素为已处理
          li.querySelectorAll('*').forEach(child => processed.add(child));
        });
        processed.add(el);
        return;
      }

      // Extract text elements (P, H1, H2, etc.)
      if (!textTags.includes(el.tagName)) return;

      const rect = el.getBoundingClientRect();
      // 对于 PRE 和 CODE 标签，保留原始文本（包括前导和尾随空白）
      // 对于其他标签：
      //   1. 使用 trim() 移除前后空白
      //   2. 将中间的连续空白字符（包括换行符）规范化为单个空格
      //   这样可以匹配浏览器的渲染行为（HTML 中的换行在浏览器中显示为空格）
      const isPreOrCode = el.tagName === 'PRE' || el.tagName === 'CODE';
      const text = isPreOrCode ? el.textContent : el.textContent.replace(/\s+/g, ' ').trim();
      if (rect.width === 0 || rect.height === 0 || !text) return;

      // Validate: Check for manual bullet symbols in text elements (not in lists) - 改为警告，自动移除bullet
      if (el.tagName !== 'LI' && /^[•\-\*▪▸○●◆◇■□]\s/.test(text.trimStart())) {
        warnings.push(
          `Text element <${el.tagName.toLowerCase()}> starts with bullet symbol, will be removed.`
        );
        // 不再return，继续处理（bullet符号会在后面被移除）
      }

      const computed = window.getComputedStyle(el);
      const rotation = getRotation(computed.transform, computed.writingMode);
      const { x, y, w, h } = getPositionAndSize(el, rect, rotation);

      // 对于 PRE 和 CODE 标签，确保使用等宽字体（如果未设置）
      let fontFace = computed.fontFamily.split(',')[0].replace(/['"]/g, '').trim();
      if (isPreOrCode && !fontFace.includes('monospace') && !fontFace.includes('Courier')) {
        fontFace = 'Courier New';
      }

      const baseStyle = {
        fontSize: pxToPoints(computed.fontSize),
        fontFace: fontFace,
        color: rgbToHex(computed.color),
        align: computed.textAlign === 'start' ? 'left' : computed.textAlign,
        lineSpacing: pxToPoints(computed.lineHeight),
        paraSpaceBefore: pxToPoints(computed.marginTop),
        paraSpaceAfter: pxToPoints(computed.marginBottom),
        // PptxGenJS margin array is [left, right, bottom, top] (not [top, right, bottom, left] as documented)
        margin: [
          pxToPoints(computed.paddingLeft),
          pxToPoints(computed.paddingRight),
          pxToPoints(computed.paddingBottom),
          pxToPoints(computed.paddingTop)
        ]
      };

      const transparency = extractAlpha(computed.color);
      if (transparency !== null) baseStyle.transparency = transparency;

      if (rotation !== null) baseStyle.rotate = rotation;

      const hasFormatting = el.querySelector('b, i, u, strong, em, span, br, pre, code, span');

      if (hasFormatting || isPreOrCode) {
        // Text with inline formatting (including PRE and CODE)
        const transformStr = computed.textTransform;
        // 对于 PRE 和 CODE，不应用 text-transform（保留原始大小写）
        const transformFunc = isPreOrCode ? (str) => str : (str) => applyTextTransform(str, transformStr);
        const runs = parseInlineFormatting(el, {}, [], transformFunc);

        // Adjust lineSpacing based on largest fontSize in runs
        const adjustedStyle = { ...baseStyle };
        if (adjustedStyle.lineSpacing) {
          const maxFontSize = Math.max(
            adjustedStyle.fontSize,
            ...runs.map(r => r.options?.fontSize || 0)
          );
          if (maxFontSize > adjustedStyle.fontSize) {
            const lineHeightMultiplier = adjustedStyle.lineSpacing / adjustedStyle.fontSize;
            adjustedStyle.lineSpacing = maxFontSize * lineHeightMultiplier;
          }
        }

        elements.push({
          type: el.tagName.toLowerCase(),
          text: runs,
          position: { x: pxToInch(x), y: pxToInch(y), w: pxToInch(w), h: pxToInch(h) },
          style: adjustedStyle
        });
      } else {
        // Plain text - inherit CSS formatting
        const textTransform = computed.textTransform;
        const transformedText = applyTextTransform(text, textTransform);

        const isBold = computed.fontWeight === 'bold' || parseInt(computed.fontWeight) >= 600;

        elements.push({
          type: el.tagName.toLowerCase(),
          text: transformedText,
          position: { x: pxToInch(x), y: pxToInch(y), w: pxToInch(w), h: pxToInch(h) },
          style: {
            ...baseStyle,
            bold: isBold && !shouldSkipBold(computed.fontFamily),
            italic: computed.fontStyle === 'italic',
            underline: computed.textDecoration.includes('underline')
          }
        });
      }

      // 将当前元素及其所有子元素添加到 processed 集合，防止重复提取
      // 这确保 <p><span>text</span></p> 不会把 span 再单独提取一次
      processed.add(el);
      el.querySelectorAll('*').forEach(child => processed.add(child));
    });

    return { background, elements, placeholders, errors, warnings };
  });
}

/**
 * 辅助函数：将页面中的 SVG 元素转换为 PNG 图片
 *
 * 功能：
 *   1. 查找页面中所有 SVG 元素
 *   2. 获取每个 SVG 的位置、尺寸和透明度
 *   3. 使用 Playwright 截图功能将 SVG 截取为 PNG
 *   4. 返回图片元素数组，可以直接添加到 slideData.elements
 *
 * 为什么需要转换？
 *   - PptxGenJS 不支持直接插入 SVG
 *   - PowerPoint 对 SVG 的支持有限（需要 Office 2016+）
 *   - 转换为 PNG 可以确保兼容性
 *
 * @param {Page} page - Playwright 页面对象
 * @param {string} tmpDir - 临时目录路径（用于保存截图）
 * @returns {Promise<Array>} 图片元素数组
 */

module.exports = extractSlideData;
