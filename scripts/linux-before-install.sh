#!/bin/sh
#
# deb preinst: 安装前终止仍在运行的旧版本实例。
#
# 背景:应用使用单实例锁(SingletonLock,位于 userData 目录)。deb 覆盖安装
# 时旧版本进程仍持有锁,新版本启动会拿不到锁而静默退出(退出码 0),用户
# 观感是"装上就报错"。这里在 dpkg 解包前杀掉旧实例,与 Windows NSIS
# 安装器的 "Stopping running 知远 processes" 阶段对齐。
#
# 匹配范围(按可执行路径,避免误杀 dpkg 自身——其命令行含 .deb 文件名):
#   - 主进程与全部子进程(renderer/GPU/node sidecar/engram):可执行路径均
#     位于 deb 安装目录 /opt/知远/ 下
#   - 用户同时运行 AppImage 时,其挂载路径 /tmp/.mount_知远* 也匹配
#
# 注意:preinst 以 root 运行,不能依赖 $HOME;因此不清 SingletonLock 文件
# (Electron 启动时会检测残留 socket 并自动清理),只杀进程。

# Current packages install /opt/知远 and mount AppImages below
# /tmp/.mount_知远*. Keep the legacy ZhiYuanAgent paths for shutdown during an
# upgrade. Both expressions match the executable/mount path, never the .deb
# filename passed to dpkg.
DEB_INSTALL_PATTERN='/opt/(知远|ZhiYuanAgent)(/|$)'
APPIMAGE_MOUNT_PATTERN='\.mount_(知远|ZhiYuanAgent)'

# 终止旧实例;pkill 无匹配时返回 1,忽略
pkill -f "$DEB_INSTALL_PATTERN" 2>/dev/null || true
pkill -f "$APPIMAGE_MOUNT_PATTERN" 2>/dev/null || true

# 等待进程退出(最多 10 秒),与 NSIS 的 15×500ms 重试循环对齐
i=0
while [ "$i" -lt 10 ]; do
  if ! pgrep -f "$DEB_INSTALL_PATTERN" >/dev/null 2>&1 &&
    ! pgrep -f "$APPIMAGE_MOUNT_PATTERN" >/dev/null 2>&1; then
    break
  fi
  sleep 1
  i=$((i + 1))
done

# A renderer or sidecar can ignore/hold shutdown long enough for the bounded
# wait above to expire. Do not leave its SingletonLock owner behind: dpkg may
# replace a running binary, but the first launch of the upgraded app would
# otherwise still exit as a second instance.
if pgrep -f "$DEB_INSTALL_PATTERN" >/dev/null 2>&1 ||
  pgrep -f "$APPIMAGE_MOUNT_PATTERN" >/dev/null 2>&1; then
  pkill -KILL -f "$DEB_INSTALL_PATTERN" 2>/dev/null || true
  pkill -KILL -f "$APPIMAGE_MOUNT_PATTERN" 2>/dev/null || true
fi

# preinst 失败不能阻塞安装,永远以 0 退出
exit 0
