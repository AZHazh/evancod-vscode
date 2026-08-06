# Evancod VSCode 插件性能问题诊断与修复

**状态**: ✅ 已批准
**创建时间**: 2026-08-06T01:27:53.702Z
**批准时间**: 2026-08-06T01:29:26.330Z

## 描述

通过对项目前后端代码的完整审查，定位到三个性能问题的根因，并制定针对性修复方案。

## 任务列表

### 1. 修复前端高频流式更新导致的卡片渲染卡顿

**文件**: webview/src/stores/chat.ts

**问题**: handleAgentEvent → content_delta 每收到一个 token 就调用 upsertAssistantText()，后者内部用 findIndex() 对整个 uiMessages 数组做 O(n) 线性扫描，再 splice 替换。一个几百字的回答会产生几百次 O(n) 扫描 + 数组重渲染。

**修复**:
1. 在 handleAgentEvent 的 content_delta 分支中，只追加 streamingText.value，不再每次都调用 upsertAssistantText()。改为用一个 requestAnimationFrame 合并：rAF 回调里统一执行一次 upsertAssistantText()。
2. upsertAssistantText/upsertToolUse 内部用一个缓存的 index 变量替代 findIndex，避免每次全量扫描。
3. syncUiMessagesFromSession 在流式追加（preserveRuntime=true 且只追加了末尾消息）时直接 return，不走完整重建逻辑。

**验收**: 流式打字时 uiMessages 数组不再每个 token 都 splice，主线程不再阻塞。

### 2. 修复 MarkdownRenderer 流式期间高频完整重新解析

**文件**: webview/src/components/markdown/MarkdownRenderer.vue

**问题**: 流式期间每个 rAF 帧都执行一次完整的 marked.parse()（含完整的 markdown 语法树解析），并创建一个全新的 marked.Renderer() 实例。当内容超过几百字时，单次 parse 可能耗时 10-30ms，直接卡满主线程。

**修复**:
1. 将 rAF 合并改为滑动窗口合并：收到 content 变化后设置一个 ~80-120ms 的定时器，期间多次变化只触发一次渲染。rAF 只用于最终帧保证。
2. 将 new marked.Renderer() 提取为模块级单例，避免每次渲染都创建新实例。
3. 考虑在流式期间只渲染纯文本（v-text），流式结束后再切换为 v-html markdown 渲染。或对流式内容做长度阈值判断，超过阈值时降级为纯文本。

**验收**: 流式打字时 MarkdownRenderer 不再每帧 parse，CPU 占用显著降低。

### 3. 修复后端每个流式 token 都 postMessage + saveSessions

**文件**: src/services/webview/WebviewManager.ts + src/services/chat/ChatService.ts

**问题**:
1. WebviewManager.setupChatEventForwarding() 中 `this.chatService.onAgentEvent(event => this.sendAgentEvent(event))` —— 每个 agent 事件（含高频 content_delta）都直接 postMessage 到 webview，无任何节流。
2. ChatService.recordAgentEvent() 在每个 content_delta 都执行 `this.saveSessions()` —— 虽然 SessionPersistenceService 有 1s 延迟，但每次都会 clearTimeout + setTimeout 重新调度，高频调用下虽然不会频繁写盘，但仍有无谓的开销。

**修复**:
1. 在 WebviewManager 中增加一个 agent 事件批量转发队列：content_delta 等高频事件在 16ms（一帧）内累积，合并为一条消息发送。message_complete / permission_request 等关键事件立即 flush。
2. ChatService.recordAgentEvent 中 content_delta 分支不再调用 saveSessions()，只在 tool_use_complete / tool_result / message_complete 等关键节点保存。

**验收**: 后端不再每个 token 都 postMessage + saveSessions，webview 收到的事件量大幅减少。

### 4. 修复授权按钮延迟——globalState 异步读写

**文件**: src/services/webview/WebviewManager.ts

**问题**: handlePermissionResponse() 和 handleQuestionAnswer() 中，权限回调存储在 `context.globalState`（VSCode 的持久化存储）中。每次用户点击授权按钮时：
1. `globalState.get('permissionCallbacks')` —— 异步读取整个 Map
2. `callbacks.get(requestId)` —— 查找回调
3. `callbacks.delete(requestId)` —— 删除
4. `await globalState.update('permissionCallbacks', callbacks)` —— 异步写回整个 Map

这个流程是异步的，且 globalState 的读写有序列化开销，导致从点击按钮到回调执行有明显延迟。

**修复**:
1. 将权限回调和问题回调改为纯内存 Map 存储（在 WebviewManager 或 QueryEngine 中维护），不再经过 globalState。
2. handlePermissionResponse / handleQuestionAnswer 改为同步查找内存 Map 并立即执行回调，去除 async/await 和 globalState 读写。
3. 保留 globalState 作为持久化兜底（可选），但热路径走内存。

**验收**: 点击授权按钮后回调几乎立即执行，无感知延迟。

### 5. 修复 SessionPersistenceService 增量快照无效导致流式数据丢失

**文件**: src/services/persistence/SessionPersistenceService.ts

**问题**: saveImmediate() 中的增量比对快照 createSessionSnapshot() 只包含 updatedAt / messageCount / transcriptLength / name。但流式过程中 transcript 的 length 不变（同一个 streaming-assistant block 被 splice 替换），只有 content 变了，所以快照不变 → 增量比对认为「没变化」→ **跳过保存**。这本身是 bug（数据不保存），但更关键的是它每次都要序列化全部 sessions 做比对，且 lastSavedSnapshot 是用 JSON.stringify 生成的字符串，高频调用时 CPU 开销不小。

同时，saveSessions() 在 ChatService.recordAgentEvent 中被高频调用（每个 token），虽然有 1s 延迟，但 scheduleSave 的 clearTimeout+setTimeout 仍有开销。

**修复**:
1. createSessionSnapshot 加入 transcript content 的 hash 或 length-of-content，确保流式更新能被检测到（修复数据丢失 bug）。
2. 在 ChatService 中降低 saveSessions 调用频率（配合任务3）。
3. 考虑将 lastSavedSnapshot 的比对从 JSON.stringify 改为更轻量的字段比对。

**验收**: 流式数据能正确保存，且保存开销降低。

### 6. 修复前端高频 console.log 干扰

**文件**: webview/src/stores/chat.ts

**问题**: syncUiMessagesFromSession() 中有大量 console.log（约5处），在流式高频调用时这些日志会产生可观的 I/O 开销，尤其影响 webview 的渲染性能。

**修复**:
1. 移除或用 if (import.meta.env.DEV) 包裹所有调试 console.log。
2. 检查其他 store 和组件中的高频路径 console.log。

**验收**: 生产构建中不再有高频 console 输出。

### 7. 修复 QueryEngine 流式事件无节流转发

**文件**: src/core/engine/QueryEngine.ts

**问题**: query() 循环中，每个 content_delta 事件都直接调用 onAgentEventCallback?.({ type: 'content_delta', text: delta })。由于 onAgentEventCallback 链路上接了 ChatService.recordAgentEvent（写 transcript + saveSessions）和 WebviewManager.sendAgentEvent（postMessage），每个 token 都触发全链路处理。

**修复**:
1. 在 QueryEngine 中对 content_delta 做批量合并：用 rAF 或微任务队列累积 delta，每 ~16-32ms 发送一次合并的 content_delta 事件。
2. message_complete / tool_use_complete / permission_request 等关键事件不合并，立即发送。

**验收**: 后端 Agent 事件转发频率从每 token 降至每帧。

## 执行步骤

1. 1. 修改 webview/src/stores/chat.ts：在 syncUiMessagesFromSession 中为非流式追加场景添加短路 return，避免完整重建
2. 2. 修改 webview/src/stores/chat.ts：新增 togglePauseStreaming 全局开关，在 content_delta/thinking/bash_output 高频事件中快速跳过整个 handleAgentEvent 的重计算
3. 3. 修改 webview/src/stores/chat.ts：在 upsertAssistantText/upsertToolUse 中用 index 变量替代 findIndex 全量扫描
4. 4. 修改 webview/src/components/markdown/MarkdownRenderer.vue：将 rAF 合并改为滑动窗口合并（~80ms），并把每次渲染的 new marked.Renderer() 提取为模块级单例
5. 5. 修改 src/services/webview/WebviewManager.ts：新增 chatEventGateThrottle，对 agent.event 做累计批量转发，在每帧或收到关键事件时 flush
6. 6. 修改 src/services/webview/WebviewManager.ts：handlePermissionResponse/handleQuestionAnswer 改为内存 Map 直接路由，不再读写 globalState
7. 7. 修改 src/services/chat/ChatService.ts：recordAgentEvent 中 saveSessions() 改为 saveSessions(false) 延迟，content_delta 不再每次保存 transcript
8. 8. 修改 src/services/persistence/SessionPersistenceService.ts：createSessionSnapshot 中移除 transcriptLength 或改为 transcript 哈希，确保延迟保存不会跳过流式 transcript 更新
9. 9. 修改 src/core/engine/QueryEngine.ts：在 query() 循环中为高频 content_delta 事件添加 rAF 节流，避免每个 token 都转发
10. 10. 重新构建 webview 和编译 TS，验证无语法错误

## 风险评估

### 🟡 MEDIUM - 修改 syncUiMessagesFromSession 的追加模式逻辑可能影响流式消息的顺序正确性，需要仔细测试文字与工具交错渲染

**缓解措施**: 保留现有 isStreaming 分支逻辑不变，只优化非流式追加路径的短路返回

### 🟡 MEDIUM - 全局 togglePauseStreaming 会影响所有 agent 事件类型，若逻辑有误可能导致部分 UI 更新被永久跳过

**缓解措施**: 确保 message_complete 和 status 事件始终穿透，不受 toggle 影响

### 🟢 LOW - 权限回调迁移到 QueryEngine 内存 Map 后，需要保证现有 ChatService.handlePermissionResponse 仍能正确路由

**缓解措施**: 保留 ChatService 同步转发逻辑，确保两条路径都能抵达 waiter
