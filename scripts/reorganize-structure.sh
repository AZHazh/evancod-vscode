#!/bin/bash

# 目录结构重组脚本
# 按照 02-技术架构设计.md 重新组织项目结构

set -e

echo "开始重组项目目录结构..."

# 1. 创建新的目录结构
echo "1. 创建新目录..."

# core/engine
mkdir -p src/core/engine

# core/services
mkdir -p src/core/services/api

# core/tools 按功能分组
mkdir -p src/core/tools/base
mkdir -p src/core/tools/file
mkdir -p src/core/tools/search
mkdir -p src/core/tools/execution
mkdir -p src/core/tools/code
mkdir -p src/core/tools/git

# tools 下已存在的目录保持不变：
# - src/core/tools/task (已存在)
# - src/core/tools/agent (已存在)
# - src/core/tools/web (已存在)
# - src/core/tools/lsp (已存在)
# - src/core/tools/notebook (已存在)
# - src/core/tools/advanced (已存在)

echo "2. 移动 core/engine 文件..."
# 移动 QueryEngine 到 engine 目录
if [ -f "src/core/QueryEngine.ts" ]; then
  git mv src/core/QueryEngine.ts src/core/engine/QueryEngine.ts
  echo "  ✓ QueryEngine.ts -> engine/"
fi

echo "3. 移动 core/services/api 文件..."
# 移动 api 目录到 services/api
if [ -d "src/core/api" ]; then
  git mv src/core/api src/core/services/api
  echo "  ✓ api/ -> services/api/"
fi

echo "4. 移动 tools/base 文件..."
# 移动 Tool.ts 到 base 目录
if [ -f "src/core/tools/Tool.ts" ]; then
  git mv src/core/tools/Tool.ts src/core/tools/base/Tool.ts
  echo "  ✓ Tool.ts -> tools/base/"
fi

echo "5. 移动 tools/file 文件..."
# 移动文件操作工具到 file 目录
for tool in FileReadTool FileEditTool FileWriteTool CopyFileTool MoveFileTool DeleteFileTool; do
  if [ -f "src/core/tools/${tool}.ts" ]; then
    git mv "src/core/tools/${tool}.ts" "src/core/tools/file/${tool}.ts"
    echo "  ✓ ${tool}.ts -> tools/file/"
  fi
done

echo "6. 移动 tools/search 文件..."
# 移动搜索工具到 search 目录
for tool in GlobTool GrepTool FindTool ListDirectoryTool; do
  if [ -f "src/core/tools/${tool}.ts" ]; then
    git mv "src/core/tools/${tool}.ts" "src/core/tools/search/${tool}.ts"
    echo "  ✓ ${tool}.ts -> tools/search/"
  fi
done

echo "7. 移动 tools/execution 文件..."
# 移动执行工具到 execution 目录
if [ -f "src/core/tools/BashTool.ts" ]; then
  git mv src/core/tools/BashTool.ts src/core/tools/execution/BashTool.ts
  echo "  ✓ BashTool.ts -> tools/execution/"
fi

echo "8. 移动 tools/code 文件..."
# 移动代码分析工具到 code 目录
for tool in ASTAnalyzerTool DependencyAnalyzerTool; do
  if [ -f "src/core/tools/${tool}.ts" ]; then
    git mv "src/core/tools/${tool}.ts" "src/core/tools/code/${tool}.ts"
    echo "  ✓ ${tool}.ts -> tools/code/"
  fi
done

echo "9. 移动 tools/git 文件..."
# 移动 Git 工具到 git 目录
for tool in GitStatusTool GitDiffTool GitLogTool GitBranchTool; do
  if [ -f "src/core/tools/${tool}.ts" ]; then
    git mv "src/core/tools/${tool}.ts" "src/core/tools/git/${tool}.ts"
    echo "  ✓ ${tool}.ts -> tools/git/"
  fi
done

echo ""
echo "✅ 目录结构重组完成！"
echo ""
echo "新的目录结构："
echo "src/core/"
echo "├── engine/"
echo "│   └── QueryEngine.ts"
echo "├── services/"
echo "│   └── api/"
echo "│       └── AnthropicClient.ts"
echo "└── tools/"
echo "    ├── base/"
echo "    │   └── Tool.ts"
echo "    ├── file/"
echo "    │   ├── FileReadTool.ts"
echo "    │   ├── FileEditTool.ts"
echo "    │   ├── FileWriteTool.ts"
echo "    │   ├── CopyFileTool.ts"
echo "    │   ├── MoveFileTool.ts"
echo "    │   └── DeleteFileTool.ts"
echo "    ├── search/"
echo "    │   ├── GlobTool.ts"
echo "    │   ├── GrepTool.ts"
echo "    │   ├── FindTool.ts"
echo "    │   └── ListDirectoryTool.ts"
echo "    ├── execution/"
echo "    │   └── BashTool.ts"
echo "    ├── code/"
echo "    │   ├── ASTAnalyzerTool.ts"
echo "    │   └── DependencyAnalyzerTool.ts"
echo "    ├── git/"
echo "    │   ├── GitStatusTool.ts"
echo "    │   ├── GitDiffTool.ts"
echo "    │   ├── GitLogTool.ts"
echo "    │   └── GitBranchTool.ts"
echo "    ├── task/"
echo "    ├── agent/"
echo "    ├── web/"
echo "    ├── lsp/"
echo "    ├── notebook/"
echo "    └── advanced/"
echo ""
echo "⚠️  下一步：需要更新所有 import 路径"
