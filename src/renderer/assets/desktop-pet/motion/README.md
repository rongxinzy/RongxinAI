# 连续动作素材

当前阶段：小远 24 条 512×512 / 30fps VP9 alpha 连续素材。其余六位伙伴暂用既有姿态图集，不能把这一步称为七位伙伴全部连续化。

素材来源为内置 imagegen 生成的原创分层部件：[源 PNG](../rigs/xiaoyuan-rig-v1.png)、[生成提示词](../rigs/xiaoyuan-rig-prompt.md)。源 PNG 保留生成字节，脚本只定义取景框、关节、层次和轨迹，按实际时间离线合成全身帧；头部、翅膀、脚、表情和围巾独立运动，不做整张立绘变形来替代关节动作。部分羽毛边缘仍有白边和散点，嘴型也需对齐原形象的尖喙，不能以自动解码测试替代美术验收。

## 重建

需要仓库依赖与宿主 `ffmpeg`（当前使用 libvpx-vp9）。没有新增产品运行时依赖或模型调用。

```bash
bun scripts/companion/media/render-motion.mjs --preview --out=/tmp/companion-owl-rig-preview
bun scripts/companion/media/render-motion.mjs
bun scripts/companion/media/render-motion.mjs --verify
```

只导出单条供作者检查可用 `--clip=flutter --out=/tmp/companion-owl-video-prototype`。完整目录以不带 `--clip` 的全量命令重建，避免残留旧条目的总清单。渲染器和关节编排的 SHA-256、原图 SHA-256、Chromium 版本、每条帧数和视频哈希记录在 `xiaoyuan/manifest.json`。

`render-motion.mjs` 是确实执行上述离线命令的独立 CLI，无导出。它登记为 Knip `entry` 的依赖图根，继续分析作者模块和共享目录的导入与导出；不加入 `ignore`、`ignoreFiles`、`ignoreIssues`，不改变任何门禁阈值。仅将已安装并在运行前检查版本的宿主 `ffmpeg` 声明为非 npm 命令；不会随产品分发编码器。参见 [Knip 入口说明](https://knip.dev/explanations/entry-files)。

验证模式会核对作者源码、原图和每份素材哈希，强制 libvpx-vp9 解码全部帧至 RGBA，核对 30fps、512px、alpha 标记与实际帧数，并检查存在至少 16 份不同的解码帧。保持仓库现有单文件 2 MiB 门禁，当前小远媒体包总预算 40 MiB，不扩展大文件白名单。它证明媒体与来源一致，不代替动作和美术判断。

## 播放边界

- 前后两路视频，真实首帧后提升前台；真实 `ended` 触发下一段，不用目录时长模拟结束。
- alpha 轮廓由全部源帧合并，用于原生透明命中区；播放失败保留对应静态状态。
- 隐藏、减少动效和切换未迁移形象时清空两路来源，丢弃闲置动作；恢复后从最新任务状态开始。
- 任务错误、待确认、思考高于闲置表演、落地和用户点播。待机以呼吸和眨眼为主；大动作低权重。瞌睡只在真实结束后接醒来，隐藏时取消这条接续。

双缓冲切换机制适配自 MIT dsh-pet `4eb75e6a5779ee7dccbed29dc83a621c1876d2f9` 的 `PetSprite.switchTo`。归属保留在 `desktopPet/videoPlayer.ts`，完整许可随产品的 `licenses/dsh-pet.txt` 分发；角色素材为本项目原创。
