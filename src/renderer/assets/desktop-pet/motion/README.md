# 连续动作素材

当前阶段：七位伙伴各有 24 条 512×512 / 30fps VP9 alpha 连续素材，共 168 条、30,870 帧。播放已经使用连续视频；原姿态图集保留为减少动效与解码失败时的静态回退。小远羽毛边缘与嘴型修订、长期资源及跨平台验收仍未完成。

素材来源为内置 imagegen 生成的原创分层部件：[源 PNG](../rigs/xiaoyuan-rig-v1.png)、[生成提示词](../rigs/xiaoyuan-rig-prompt.md)。源 PNG 保留生成字节，脚本只定义取景框、关节、层次和轨迹，按实际时间离线合成全身帧；头部、翅膀、脚、表情和围巾独立运动，不做整张立绘变形来替代关节动作。部分羽毛边缘仍有白边和散点，嘴型也需对齐原形象的尖喙，不能以自动解码测试替代美术验收。

六位新增伙伴的原图为 `../rigs/<character>-rig-v1.png`，实际尺寸均为 1254×1254；完整初始与修订提示词见 [生成记录](../rigs/companion-rig-prompts.json)。生成后的源图没有程序修图。离线作者按连通透明轮廓定位完整部件，避免脚跨过名义网格后被错误取进脸部；四种表情共用取景原点。眨眼只压缩一组眼睛，不叠两组五官。每位伙伴的关节、步频、尾巴/耳朵/翅膀及探看、梳理、舞蹈有独立编排。

## 重建

需要仓库依赖与宿主 `ffmpeg`（当前使用 libvpx-vp9）。没有新增产品运行时依赖或模型调用。

```bash
bun scripts/companion/media/render-motion.mjs --preview --out=/tmp/companion-owl-rig-preview
bun scripts/companion/media/render-motion.mjs
bun scripts/companion/media/render-motion.mjs --verify
bun scripts/companion/media/render-motion.mjs --character=youli --preview --out=/tmp/companion-youli-preview
bun scripts/companion/media/render-motion.mjs --character=youli
bun scripts/companion/media/render-motion.mjs --character=youli --verify
bun scripts/companion/media/render-motion.mjs --character=yunmo --crf=28
```

形象参数为 `xiaoyuan/youli/tuantuan/mianmian/zhuli/yunmo/maixiao`。只导出单条供作者检查可用 `--clip=flutter --out=/tmp/companion-owl-video-prototype`。完整目录以不带 `--clip` 的全量命令重建，避免残留旧条目的总清单。渲染器和关节编排的 SHA-256、原图 SHA-256、Chromium 版本、每条帧数和视频哈希记录在各角色 `manifest.json`。默认 CRF 25；幼龙使用 28，保持 30fps、512px 与全部帧数以符合原有单文件预算。该编码值为离线制作参数，不是用户设置。

`render-motion.mjs` 是确实执行上述离线命令的独立 CLI，无导出。它登记为 Knip `entry` 的依赖图根，继续分析作者模块和共享目录的导入与导出；不加入 `ignore`、`ignoreFiles`、`ignoreIssues`，不改变任何门禁阈值。仅将已安装并在运行前检查版本的宿主 `ffmpeg` 声明为非 npm 命令；不会随产品分发编码器。参见 [Knip 入口说明](https://knip.dev/explanations/entry-files)。

验证模式会核对作者源码、原图和每份素材哈希，强制 libvpx-vp9 解码全部帧至 RGBA，核对 30fps、512px、alpha 标记与实际帧数，并检查存在至少 16 份不同的解码帧。独立 PNG 解码还检查二值命中轮廓、非空内容、记录边界和四像素安全边距。保持仓库现有单文件 2 MiB 门禁和每形象 40 MiB 整包预算，不扩展大文件白名单。七包总计 181,968,521 字节（约 173.5 MiB，含海报、轮廓与清单），只加载当前两路视频，不预下载所有视频。它证明媒体与来源一致，不代替动作和美术判断。

## 播放边界

- 前后两路视频，真实首帧后提升前台；真实 `ended` 触发下一段，不用目录时长模拟结束。
- alpha 轮廓由全部源帧合并，用于原生透明命中区；播放失败保留对应静态状态。
- 隐藏、减少动效、切换形象或未知形象时清空旧来源，丢弃闲置动作；恢复后从最新任务状态开始。不完整素材包不会进入连续播放。
- 任务错误、待确认、思考高于闲置表演、落地和用户点播。待机以呼吸和眨眼为主；大动作低权重。瞌睡只在真实结束后接醒来，隐藏时取消这条接续。

双缓冲切换机制适配自 MIT dsh-pet `4eb75e6a5779ee7dccbed29dc83a621c1876d2f9` 的 `PetSprite.switchTo`。归属保留在 `desktopPet/videoPlayer.ts`，完整许可随产品的 `licenses/dsh-pet.txt` 分发；角色素材为本项目原创。
