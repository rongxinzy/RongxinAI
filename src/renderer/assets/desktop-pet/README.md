# 桌面伙伴素材

启动欢迎群像见 [companions-welcome.png](companions-welcome.png)，七位伙伴共同入画，透明背景；生成方式与提示词见 [welcome-prompt.md](welcome-prompt.md)。这是独立的启动插画，不影响动作图集或角色选择。

六个新角色通过内置 `image_gen.imagegen` 分别生成并修整留白，保留工具返回的透明 PNG；没有程序化修改或重新编码图片。生成规格、角色提示词及修整提示词见 [prompts.json](prompts.json)。

| 角色 | 素材 | 动作性格 |
| --- | --- | --- |
| 游栗 · 赤狐 | [youli-atlas.png](youli-atlas.png) | 好奇、敏捷，侧看与探头 |
| 团团 · 海獭 | [tuantuan-atlas.png](tuantuan-atlas.png) | 柔软、舒缓，点头与蜷睡 |
| 绵绵 · 垂耳兔 | [mianmian-atlas.png](mianmian-atlas.png) | 轻盈、弹跳，耳朵随姿态变化 |
| 竹栗 · 小熊猫 | [zhuli-atlas.png](zhuli-atlas.png) | 松弛、温暖，伸展与挥手 |
| 云墨 · 幼龙 | [yunmo-atlas.png](yunmo-atlas.png) | 活泼、舒展，展翼与跳跃 |
| 麦小 · 柯基 | [maixiao-atlas.png](maixiao-atlas.png) | 热情、欢快，蓄力与庆祝 |

每张新图集为 1448×1086、4×3 排列。姿态顺序：待机、思考、待确认、完成、出错、招呼、眨眼、伸展、蜷睡、警觉、蓄力、跳跃。生成图并非严格像素对齐，因此使用 [frames.json](frames.json) 的独立取景框，不按均分格裁切；坐标来自透明轮廓分析，每框保留 8px 留白，共用角色尺寸基准，避免串格和睡姿被放大。浏览器守护检查全部 72 个取景框边界透明。原小远图集保持 3×2，扩展姿态通过共享目录映射到原有六姿态。

动作定义在 `desktopPet/sequenceClips.ts`，播放器使用经过时间采样；5 套动作按角色节奏约 6–15 秒。姿态切换只在节拍边界短暂融合，避免持续重影；几何运动用平滑插值。任务错误/待确认/运行中、拖动、漫游、隐藏和减少动效优先于表演。不产生模型请求，不写任务状态，不改变失败提醒。

设置路径：设置 → 通用 → 桌面伙伴 → 伙伴形象。选择自动保存，与桌宠窗口同步；默认仍关闭。

开发预览（仅 DEV 生效）：`/desktop-pet.html?character=youli&action=happy`；`state` 可指定六种任务状态。生产版不通过 URL 改写任务状态或设置。
