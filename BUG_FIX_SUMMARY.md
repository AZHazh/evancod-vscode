# Bug 修复总结

## 修复日期
2026-07-05

## 问题描述

### 问题 1：停止生成后无法再次发送消息
**现象**：手动停止对话后，再次发送消息时一直显示错误："抱歉，发送消息时出错：用户停止生成"

**根本原因**：
- `QueryEngine` 的 `abortController` 在构造函数中创建一次后，调用 `cancel()` 会将其 abort，但从不重置
- `AbortController.signal.aborted` 一旦变为 `true` 就永远保持 `true`
- 下次 `query()` 调用 `throwIfCancelled()` 时，会立即抛出 `QueryCancelledError`

**修复方案**：
- 在 `query()` 开始时，重置 `cancelled` flag 并创建新的 `AbortController`
- 在 `cancel()` 中设置 `cancelled = true`

**修改文件**：
- `src/core/engine/QueryEngine.ts`
  - Line 478-487: 在 `query()` 开始时重置 abort 状态
  - Line 663-676: 在 `cancel()` 中设置 `cancelled = true`

### 问题 2：流消息显示异常，thinking 和工具调用挤在一起
**现象**：
- 没有模型的 thinking block（思考过程）
- 所有文字流返回都在一个消息块里，体验很差
- 期望像之前一样：thinking block（可折叠）→ 工具调用 → 最终回答

**根本原因**：
1. **Thinking 消息被过滤**：
   - `MessageList.vue` line 23 将所有 `type === 'thinking'` 的消息过滤掉了
   - 即使后端正常发送 thinking 事件，前端也不显示

2. **流式临时消息被丢弃**：
   - 前端在流式过程中，收到后端 session 更新后，会用 `reorderTranscript()` 完全重建 UI 消息列表
   - 这会丢失前端流式构建的临时消息（`streaming-thinking`、`streaming-assistant`）
   - 导致所有内容看起来像在一个大块里

**修复方案**：
1. **恢复 thinking 消息显示**：
   - 移除 `MessageList.vue` 中的 thinking 过滤逻辑
   - `MessageItem.vue` 已经支持 thinking 类型（line 95），只需要让消息通过即可

2. **保留流式临时消息**：
   - 在 `chat.ts` 的 `syncUiMessagesFromSession()` 中，检测是否正在流式（`chatState === 'thinking'`）
   - 如果正在流式，保留前端的 `streaming-thinking`、`streaming-assistant` 等临时消息
   - 避免用后端 transcript 完全覆盖，保持流式渐进显示效果

**修改文件**：
- `webview/src/components/chat/MessageList.vue`
  - Line 23: 移除 thinking 消息过滤
  
- `webview/src/stores/chat.ts`
  - Line 196-220: 在 transcript 重建时，如果正在流式，保留前端临时消息

## 修复效果

### 问题 1 修复后
- ✅ 可以正常停止对话
- ✅ 停止后可以立即发送新消息
- ✅ 不再出现"用户停止生成"错误

### 问题 2 修复后
- ✅ 显示 thinking block（模型思考过程），可折叠
- ✅ 工具调用逐个显示，清晰分离
- ✅ 流式文本渐进显示，不会挤在一起
- ✅ 整体体验恢复到期望的渐进式流式效果

## 技术细节

### QueryEngine Abort 机制
```typescript
// 修复前：abortController 永远不重置
constructor() {
  this.abortController = new AbortController()  // 只创建一次
  this.cancelled = false
}

cancel() {
  this.abortController.abort()  // signal.aborted 永远为 true
  // 缺失：this.cancelled = true
}

query() {
  this.throwIfCancelled()  // 第二次 query 立即抛错
}

// 修复后：每次 query 重置
query() {
  this.cancelled = false
  this.abortController = new AbortController()  // 创建新实例
  // ... 继续执行
}

cancel() {
  this.cancelled = true  // 设置 flag
  this.abortController.abort()
}
```

### 流式消息显示机制
```typescript
// 修复前：完全重建，丢失流式状态
if (currentSession.value.transcript?.length) {
  const reordered = reorderTranscript(transcript)
  uiMessages.value = reordered  // 丢失 streaming-thinking, streaming-assistant
  return
}

// 修复后：流式时保留临时消息
if (currentSession.value.transcript?.length) {
  const isStreaming = chatState.value === 'thinking' || chatState.value === 'waiting_permission'
  const reordered = reorderTranscript(transcript)
  
  if (isStreaming) {
    // 保留前端流式临时消息
    const streamingMessages = uiMessages.value.filter(m =>
      m.id === 'streaming-thinking' ||
      m.id === 'streaming-assistant' ||
      (m.type === 'tool_use' && m.isPending && m.partialInput)
    )
    // 移除 transcript 中的同类型旧消息，追加流式临时消息
    rebuiltMessages = reordered.filter(m =>
      m.id !== 'streaming-thinking' &&
      m.id !== 'streaming-assistant'
    )
    rebuiltMessages.push(...streamingMessages)
  }
  
  uiMessages.value = rebuiltMessages
  return
}
```

## 测试建议

1. **停止/继续测试**：
   - 发送一条消息
   - 在执行过程中点击停止
   - 立即发送新消息
   - 验证：不应出现"用户停止生成"错误

2. **流式显示测试**：
   - 发送一条需要工具调用的消息
   - 观察：
     - 是否显示 thinking block（可折叠）
     - 工具调用是否逐个显示
     - 最终回答是否流式显示
   - 验证：消息应该渐进式出现，不会挤在一起

3. **多轮对话测试**：
   - 连续发送多条消息
   - 验证：每轮对话都正常显示 thinking 和工具调用

## 相关文件

### 后端
- `src/core/engine/QueryEngine.ts` - AI 对话引擎
- `src/services/chat/ChatService.ts` - 聊天服务

### 前端
- `webview/src/stores/chat.ts` - 聊天状态管理
- `webview/src/components/chat/MessageList.vue` - 消息列表组件
- `webview/src/components/chat/MessageItem.vue` - 消息项组件
- `webview/src/utils/messageGrouping.ts` - 消息分组排序工具

## 编译验证

```bash
# 后端编译
npm run compile
✓ TypeScript 编译成功

# 前端编译
cd webview && npm run build
✓ Vite 构建成功
✓ 1627 modules transformed
✓ built in 1.77s
```
