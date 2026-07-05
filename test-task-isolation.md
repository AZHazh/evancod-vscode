# 任务隔离测试计划

## 测试目标
验证不同会话的任务ID是否从1开始，且互不干扰

## 测试步骤

### 1. 创建第一个会话并创建任务
- 启动扩展
- 创建新会话（会话A）
- 创建3个任务
- **预期结果**: 任务ID应该是 #1, #2, #3

### 2. 创建第二个会话并创建任务
- 创建新会话（会话B）
- 创建2个任务
- **预期结果**: 任务ID应该是 #1, #2（不是 #4, #5）

### 3. 切换回第一个会话
- 切换到会话A
- **预期结果**: 应该只显示会话A的3个任务（#1, #2, #3）

### 4. 切换到第二个会话
- 切换到会话B
- **预期结果**: 应该只显示会话B的2个任务（#1, #2）

### 5. 验证任务持久化
- 重新加载扩展
- 切换会话
- **预期结果**: 每个会话的任务都能正确恢复

## 存储位置验证
检查 `~/.vscode/globalStorage/{publisherId}.evancod/tasks/` 目录结构：
```
tasks/
  ├── {会话A-ID}/
  │   ├── .highwatermark  (内容: 3)
  │   ├── task-1.json
  │   ├── task-2.json
  │   └── task-3.json
  └── {会话B-ID}/
      ├── .highwatermark  (内容: 2)
      ├── task-1.json
      └── task-2.json
```

## 已修改的文件
- `src/tasks/TaskStore.ts` - 接收sessionId替代taskListId
- `src/services/task/TaskManager.ts` - 管理多个TaskStore实例
- `src/services/chat/ChatService.ts` - 会话切换时加载对应任务
- `src/extension.ts` - 命令处理改为async
- `src/services/webview/WebviewManager.ts` - 消息处理改为async
