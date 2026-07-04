#!/bin/bash

# 目录结构重组脚本（非 git 版本）
# 按照 02-技术架构设计.md 重新组织项目结构

set -e

cd /Users/mr_an/Documents/vscode-evancod

echo "开始重组项目目录结构..."

# 1. 创建新的目录结构
echo "1. 创建新目录..."
mkdir -p src/core/engine
mkdir -p src/core/services/api
mkdir -p src/core/tools/base
mkdir -p src/core/tools/file
mkdir -p src/core/tools/search
mkdir -p src/core/tools/execution
mkdir -p src/core/tools/code
mkdir -p src/core/tools/git

echo "2. 移动 core/engine 文件..."
if [ -f "src/core/QueryEngine.ts" ]; then
  mv src/core/QueryEngine.ts src/core/engine/QueryEngine.ts
  echo "  ✓ QueryEngine.ts -> engine/"
fi

echo "3. 移动 core/services/api 文件..."
if [ -f "src/core/api/AnthropicClient.ts" ]; then
  mv src/core/api/AnthropicClient.ts src/core/services/api/AnthropicClient.ts
  rmdir src/core/api 2>/dev/null || true
  echo "  ✓ AnthropicClient.ts -> services/api/"
fi

echo "4. 移动 tools/base 文件..."
if [ -f "src/core/tools/Tool.ts" ]; then
  mv src/core/tools/Tool.ts src/core/tools/base/Tool.ts
  echo "  ✓ Tool.ts -> tools/base/"
fi

echo "5. 移动 tools/file 文件..."
for tool in FileReadTool FileEditTool FileWriteTool CopyFileTool MoveFileTool DeleteFileTool; do
  if [ -f "src/core/tools/${tool}.ts" ]; then
    mv "src/core/tools/${tool}.ts" "src/core/tools/file/${tool}.ts"
    echo "  ✓ ${tool}.ts -> tools/file/"
  fi
done

echo "6. 移动 tools/search 文件..."
for tool in GlobTool GrepTool FindTool ListDirectoryTool; do
  if [ -f "src/core/tools/${tool}.ts" ]; then
    mv "src/core/tools/${tool}.ts" "src/core/tools/search/${tool}.ts"
    echo "  ✓ ${tool}.ts -> tools/search/"
  fi
done

echo "7. 移动 tools/execution 文件..."
if [ -f "src/core/tools/BashTool.ts" ]; then
  mv src/core/tools/BashTool.ts src/core/tools/execution/BashTool.ts
  echo "  ✓ BashTool.ts -> tools/execution/"
fi

echo "8. 移动 tools/code 文件..."
for tool in ASTAnalyzerTool DependencyAnalyzerTool; do
  if [ -f "src/core/tools/${tool}.ts" ]; then
    mv "src/core/tools/${tool}.ts" "src/core/tools/code/${tool}.ts"
    echo "  ✓ ${tool}.ts -> tools/code/"
  fi
done

echo "9. 移动 tools/git 文件..."
for tool in GitStatusTool GitDiffTool GitLogTool GitBranchTool; do
  if [ -f "src/core/tools/${tool}.ts" ]; then
    mv "src/core/tools/${tool}.ts" "src/core/tools/git/${tool}.ts"
    echo "  ✓ ${tool}.ts -> tools/git/"
  fi
done

echo ""
echo "✅ 目录结构重组完成！"
echo ""
echo "现在需要更新 import 路径..."
