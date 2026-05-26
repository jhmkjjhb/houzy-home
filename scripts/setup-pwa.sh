#!/bin/bash
# 一次性配置:让 git 启用 .githooks/pre-commit
# 这个脚本只需在每个新 clone 的工作副本里跑一次
set -e
cd "$(dirname "$0")/.."

# 配置 git 使用项目内的 hooks 目录
git config core.hooksPath .githooks
chmod +x .githooks/pre-commit

# 首次也立刻给 sw.js 注入一个版本号,免得初次 push 之前是 __SW_VERSION__ 占位符
HASH=$(git rev-parse --short HEAD 2>/dev/null || echo "init")
TS=$(date -u +%Y%m%d%H%M%S)
VERSION="${HASH}-${TS}"
if sed --version >/dev/null 2>&1; then
  sed -i "s|const CACHE_VERSION = '[^']*';|const CACHE_VERSION = '${VERSION}';|" sw.js
else
  sed -i '' "s|const CACHE_VERSION = '[^']*';|const CACHE_VERSION = '${VERSION}';|" sw.js
fi

echo "✓ PWA pre-commit hook 已启用"
echo "✓ sw.js CACHE_VERSION 初始化为: ${VERSION}"
echo ""
echo "以后每次 git commit 会自动给 sw.js 换新版本号,无需手动操作。"
