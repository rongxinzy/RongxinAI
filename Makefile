# ZhiYuan Agent development shortcuts.
# Thin wrapper over `bun run` — package.json scripts remain the source of truth.
# Run `make` or `make help` to list targets.

SHELL := /bin/bash
.DEFAULT_GOAL := help

ENGRAM_PIN := $(shell node -p "require('./package.json').engram.version" 2>/dev/null)

## help: 列出全部可用目标
help:
	@grep -E '^## [a-z]' $(MAKEFILE_LIST) | \
		awk -F': ' '{ sub(/^## /, "", $$1); printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2 }'

## install: 安装依赖（bun install，含 postinstall 原生模块）
install:
	bun install

## dev: 启动 Electron 开发模式（Vite 热重载）
dev:
	bun run electron:dev

## dev-enterprise: 启动企业版扩展开发模式
dev-enterprise:
	bun run electron:dev:enterprise

## web: 浏览器预览（端口 5176，无需 Electron）
web:
	bun run web:preview

## web-check: 浅色/深色走查主要界面，console error 即失败
web-check:
	bun run web:preview:check

## build: 生产构建（TS + Vite）
build:
	bun run build

## compile-electron: 仅编译主进程
compile-electron:
	bun run compile:electron

## lint: oxlint + theme:check + theme:audit
lint:
	bun run lint

## format: oxfmt 全量格式化
format:
	bun run format

## format-check: 提交前格式检查
format-check:
	bun run format:check

## knip: 死代码/未用依赖检查
knip:
	bun run knip

## test: 默认单测
test:
	bun run test

## test-full: 发版前完整测试（含 Electron 原生 ABI 夹具）
test-full:
	bun run test:full

## test-enterprise: 企业扩展测试
test-enterprise:
	bun run test:enterprise

## theme-generate: 改 token/recipe/生成器后重新生成主题
theme-generate:
	bun run theme:generate

## rebuild-native: 原生模块依赖变更后重编译（better-sqlite3、node-pty）
rebuild-native:
	bun run rebuild:electron-native

## runtimes: 下载/校验 channel 与 engram 宿主运行时（缓存有效时秒过）
runtimes:
	bun run channel:runtime:download
	bun run engram:runtime:host

## dist-mac: 打包 macOS
dist-mac:
	bun run dist:mac

## dist-win: 打包 Windows
dist-win:
	bun run dist:win

## dist-win-defense: 本地打包 Windows x64 国防版
dist-win-defense:
	bun run dist:win:defense

## dist-kylin-defense: 本地打包麒麟 V11 x64 国防版 RPM
dist-kylin-defense:
	bun run dist:kylin:defense

## dist-linux: 打包 Linux
dist-linux:
	bun run dist:linux

## clean: 删除构建产物（dist、dist-electron，不动 release/）
clean:
	rm -rf dist dist-electron

## doctor: 体检开发环境（Node/Bun 版本、engram 运行时缓存、GitHub 连通性）
doctor:
	@fail=0; \
	check() { if eval "$$2"; then echo "  ok    $$1"; else echo "  FAIL  $$1"; fail=1; fi; }; \
	node_ver=$$(node -p "process.versions.node" 2>/dev/null); \
	check "Node $$node_ver (要求 >=24 <25)" "[ $${node_ver%%.*} -eq 24 ]"; \
	bun_ver=$$(bun --version 2>/dev/null); \
	check "Bun $$bun_ver (要求 >=1.4 <1.5)" "[[ $$bun_ver == 1.4.* ]]"; \
	engram_cur=$$(node -p "try{require('./vendor/engram-runtime/current/runtime-build-info.json').version}catch{''}" 2>/dev/null); \
	check "engram 运行时 $$engram_cur (pin: $(ENGRAM_PIN))" "[ -n \"$$engram_cur\" ] && [ \"$$engram_cur\" = \"$(ENGRAM_PIN)\" ]"; \
	if curl -sI --connect-timeout 5 https://github.com >/dev/null 2>&1; then \
		echo "  ok    github.com 可达"; \
	else \
		echo "  FAIL  github.com 不可达 —— 运行时下载需要直连或代理（HTTPS_PROXY / git http.proxy）"; fail=1; \
	fi; \
	if [ $$fail -eq 0 ]; then echo "环境就绪。"; else echo "存在未通过项，按上面提示修复。"; exit 1; fi

.PHONY: help install dev dev-enterprise web web-check build compile-electron \
	lint format format-check knip test test-full test-enterprise \
	theme-generate rebuild-native runtimes dist-mac dist-win dist-linux \
	dist-win-defense dist-kylin-defense clean doctor
