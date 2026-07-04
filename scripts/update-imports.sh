#!/bin/bash

# 更新 import 路径脚本

cd /Users/mr_an/Documents/vscode-evancod

echo "开始更新 import 路径..."

# 1. 更新 Tool 基类的导入路径
echo "1. 更新 Tool 基类引用..."
find src -type f -name "*.ts" -not -path "*/node_modules/*" -exec sed -i '' \
  -e "s|from '../Tool'|from '../base/Tool'|g" \
  -e "s|from './Tool'|from './base/Tool'|g" \
  -e "s|from '../../tools/Tool'|from '../../tools/base/Tool'|g" \
  -e "s|from '@/core/tools/Tool'|from '@/core/tools/base/Tool'|g" \
  {} \;

# 2. 更新 QueryEngine 的导入路径
echo "2. 更新 QueryEngine 引用..."
find src -type f -name "*.ts" -not -path "*/node_modules/*" -exec sed -i '' \
  -e "s|from '@/core/QueryEngine'|from '@/core/engine/QueryEngine'|g" \
  -e "s|from '../core/QueryEngine'|from '../core/engine/QueryEngine'|g" \
  -e "s|from '../../core/QueryEngine'|from '../../core/engine/QueryEngine'|g" \
  -e "s|import { QueryEngine } from '@/core/QueryEngine'|import { QueryEngine } from '@/core/engine/QueryEngine'|g" \
  {} \;

# 3. 更新 AnthropicClient 的导入路径
echo "3. 更新 AnthropicClient 引用..."
find src -type f -name "*.ts" -not -path "*/node_modules/*" -exec sed -i '' \
  -e "s|from './api/AnthropicClient'|from './services/api/AnthropicClient'|g" \
  -e "s|from '@/core/api/AnthropicClient'|from '@/core/services/api/AnthropicClient'|g" \
  {} \;

# 4. 更新 tools/index.ts 中的导出路径
echo "4. 更新 tools/index.ts..."
cat > src/core/tools/index.ts << 'EOF'
// Tool 基类
export { Tool, ToolDefinition, ToolResult } from './base/Tool'

// 文件操作工具
export { FileReadTool } from './file/FileReadTool'
export { FileEditTool } from './file/FileEditTool'
export { FileWriteTool } from './file/FileWriteTool'
export { CopyFileTool } from './file/CopyFileTool'
export { MoveFileTool } from './file/MoveFileTool'
export { DeleteFileTool } from './file/DeleteFileTool'

// 搜索工具
export { GlobTool } from './search/GlobTool'
export { GrepTool } from './search/GrepTool'
export { FindTool } from './search/FindTool'
export { ListDirectoryTool } from './search/ListDirectoryTool'

// 命令执行工具
export { BashTool } from './execution/BashTool'

// 代码分析工具
export { ASTAnalyzerTool } from './code/ASTAnalyzerTool'
export { DependencyAnalyzerTool } from './code/DependencyAnalyzerTool'

// Git 工具
export { GitStatusTool } from './git/GitStatusTool'
export { GitDiffTool } from './git/GitDiffTool'
export { GitLogTool } from './git/GitLogTool'
export { GitBranchTool } from './git/GitBranchTool'

// Task 任务管理工具（Phase 6 Week 1）
export { TaskCreateTool } from './task/TaskCreateTool'
export { TaskUpdateTool } from './task/TaskUpdateTool'
export { TaskListTool } from './task/TaskListTool'
export { TaskGetTool } from './task/TaskGetTool'

// Plan Mode 计划模式工具（Phase 6 Week 2）
export { EnterPlanModeTool } from './advanced/EnterPlanModeTool'
export { ExitPlanModeTool } from './advanced/ExitPlanModeTool'

// Agent 交互与协作工具（Phase 6 Week 3）
export { AskUserQuestionTool } from './agent/AskUserQuestionTool'
export { AgentTool } from './agent/AgentTool'

// 高级工具（Phase 6.5）
export { LSPTool } from './lsp/LSPTool'
export { WebFetchTool } from './web/WebFetchTool'
export { WebSearchTool } from './web/WebSearchTool'
export { NotebookEditTool } from './notebook/NotebookEditTool'
EOF

echo "5. 更新各个工具文件内部的 Tool 导入..."
# 文件工具
find src/core/tools/file -name "*.ts" -exec sed -i '' \
  "s|from '../Tool'|from '../base/Tool'|g" {} \;

# 搜索工具
find src/core/tools/search -name "*.ts" -exec sed -i '' \
  "s|from '../Tool'|from '../base/Tool'|g" {} \;

# 执行工具
find src/core/tools/execution -name "*.ts" -exec sed -i '' \
  "s|from '../Tool'|from '../base/Tool'|g" {} \;

# 代码工具
find src/core/tools/code -name "*.ts" -exec sed -i '' \
  "s|from '../Tool'|from '../base/Tool'|g" {} \;

# Git 工具
find src/core/tools/git -name "*.ts" -exec sed -i '' \
  "s|from '../Tool'|from '../base/Tool'|g" {} \;

echo ""
echo "✅ Import 路径更新完成！"
echo ""
echo "建议手动检查以下文件的 import："
echo "  - src/core/engine/QueryEngine.ts"
echo "  - src/services/chat/ChatService.ts"
echo "  - src/extension.ts"
echo ""
