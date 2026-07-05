# 滚动卡顿根因分析

## 问题现象

用户反馈："切换会话记录也好，还是切换后立马滚动也好，总是还有一些卡顿"

## 已实施的优化

1. ✅ 消息数量缓存（避免遍历计算）
2. ✅ 增量消息更新（追加模式复用已有消息）
3. ✅ 增量持久化（只保存变更会话）
4. ✅ scroll 事件 rAF 节流
5. ✅ `content-visibility: auto`（离屏消息跳过渲染）
6. ✅ `v-memo`（历史消息跳过 diff）
7. ✅ passive scroll 监听
8. ✅ MarkdownRenderer 实例级配置（避免全局污染）

## 根因分析

### 1. 架构层面的性能瓶颈

#### 1.1 全量 DOM 渲染
**位置**: `webview/src/components/chat/MessageList.vue`

```vue
<MessageItem
  v-for="message in enhancedMessages"
  :key="message.id"
  v-memo="[message.id, message]"
  :message="message"
/>
```

**问题**:
- 即使有 `content-visibility: auto`，浏览器仍需为所有消息创建 DOM 节点
- 50 条消息 × 平均每条 10+ 个 DOM 节点 = 500+ 个节点
- 100 条消息场景下达到 1000+ 个节点

**证据**:
- `content-visibility` 只跳过**离屏消息的布局和绘制**，不跳过 DOM 创建
- Vue `v-for` 会为每个消息创建完整的组件实例和 DOM 树

**影响**:
- 初次渲染慢
- 切换会话时需要销毁旧 DOM + 创建新 DOM
- 内存占用高

#### 1.2 Markdown 解析开销
**位置**: `webview/src/components/markdown/MarkdownRenderer.vue`

```typescript
function renderMarkdown() {
  const renderer = new marked.Renderer()
  // ... 自定义 renderer
  renderedHtml.value = marked.parse(props.content, {
    gfm: true,
    breaks: true,
    renderer,
  }) as string
}
```

**问题**:
- 每个消息的 Markdown 都需要实时解析
- `marked.parse()` 是同步操作，会阻塞主线程
- 长回复（1000+ 字符）解析耗时 5-20ms
- 50 条消息 × 平均 10ms = 500ms 阻塞

**证据**:
- `MessageItem.vue` 中每个 assistant 消息都包含 `<MarkdownRenderer>`
- `watch(() => props.content)` 在内容变化时重新解析
- 没有解析结果缓存机制

**影响**:
- 切换会话时需要重新解析所有历史消息
- 滚动到新消息区域触发 `content-visibility` 重新渲染时，需要重新解析
- CPU 占用高

#### 1.3 会话切换的数据加载
**位置**: `src/services/webview/WebviewManager.ts:305-316`

```typescript
case 'session.load': {
  const loaded = this.chatService.loadSession(message.data.sessionId)
  if (loaded) {
    this.postMessage({
      type: 'session.restored',
      data: {
        session: await this.chatService.hydrateSessionImages(loaded),
        sessions: this.chatService.getSessions(),
      },
    })
    this.sendSessionList()
    this.postRuntimeState()
  }
  break
}
```

**问题**:
- 切换会话时一次性发送**完整的会话数据**（包括所有消息和 transcript）
- `hydrateSessionImages` 需要读取磁盘上的图片文件转 base64
- Extension → Webview 的消息传输通过序列化/反序列化

**证据**:
- `session.restored` 消息包含完整 `session` 对象
- `session.messages` 数组可能有数百条消息
- `session.transcript` 包含所有 UI 渲染需要的详细数据

**影响**:
- 大会话（100+ 消息）的序列化/反序列化耗时 50-200ms
- 网络传输延迟（即使是本地 IPC）
- Webview 收到数据后需要重新构建整个 UI 状态

#### 1.4 响应式系统开销
**位置**: `webview/src/stores/chat.ts:150-284`

```typescript
function syncUiMessagesFromSession(preserveRuntime = false) {
  // ... 大量的数组遍历、过滤、映射操作
  const nextMessages: UIMessage[] = []
  for (let i = startIndex; i < currentSession.value.messages.length; i++) {
    const message = currentSession.value.messages[i]
    // ... 处理每条消息
  }
  uiMessages.value = removeReconciledOptimisticMessages(nextMessages)
}
```

**问题**:
- `uiMessages` 是响应式数组，赋值时触发 Vue 的依赖追踪
- 每次切换会话都要重建整个 `uiMessages` 数组
- 多个 computed 依赖 `uiMessages`，触发级联更新

**影响**:
- 切换会话时 Vue 需要 diff 新旧消息列表
- 响应式系统的 getter/setter 开销
- 组件重新渲染的调度开销

### 2. 数据流分析

#### 切换会话的完整路径

```
用户点击切换
  ↓
Webview: openSession(sessionId)
  ↓
Extension: WebviewManager.setupMessageHandler → 'session.load'
  ↓
Extension: ChatService.loadSession()
  - 切换 currentSessionId
  - 加载 TaskManager
  ↓
Extension: ChatService.hydrateSessionImages()
  - 读取磁盘图片文件
  - 转换为 base64
  ↓
Extension: WebviewManager.postMessage('session.restored')
  - 序列化完整 session 对象
  - IPC 传输
  ↓
Webview: chat store 'session.restored' handler
  ↓
Webview: syncUiMessagesFromSession()
  - 重建 uiMessages 数组 (100+ 消息 × 处理逻辑)
  - 触发响应式更新
  ↓
Webview: MessageList.vue 重新渲染
  - Vue diff 算法对比新旧 vnode
  - 销毁旧组件实例
  - 创建新组件实例
  ↓
Webview: MessageItem.vue × 100+
  - 每个消息创建 DOM
  - MarkdownRenderer 解析 Markdown (阻塞主线程)
  - 应用样式、布局计算
  ↓
Webview: 浏览器渲染
  - Layout (布局)
  - Paint (绘制)
  - Composite (合成)
  ↓
用户看到新会话
```

**总耗时估算**（100 条消息场景）:
- Extension 加载会话: 10-30ms
- 图片 hydrate: 20-50ms（如果有图片）
- IPC 序列化传输: 50-100ms
- Webview 反序列化: 20-50ms
- syncUiMessagesFromSession: 50-100ms
- Vue diff + 组件创建: 100-200ms
- Markdown 解析: 500-1000ms (主要瓶颈)
- 浏览器首次布局: 50-150ms

**总计: 800-1680ms**，用户感知明显卡顿（>100ms）

### 3. 滚动卡顿的具体场景

#### 3.1 切换会话后立即滚动
**问题**:
- 新消息 DOM 尚未完全创建完成
- Markdown 仍在解析中（阻塞主线程）
- `content-visibility` 的占位高度估算不准确
- 滚动触发新的离屏消息进入可视区域，触发新一轮 Markdown 解析

**表现**:
- 滚动条跳动
- 滚动不流畅，有顿挫感
- 滚动时 CPU 飙高

#### 3.2 在长会话中滚动
**问题**:
- 虽然有 `content-visibility: auto`，但快速滚动时大量消息快速进出可视区域
- 每次消息进入可视区域都触发 Markdown 重新解析
- rAF 节流的 scroll 处理逻辑仍在执行

**表现**:
- 快速滚动时掉帧
- 滚动停止后仍有延迟才完全渲染

## 根本原因总结

**核心问题**: 当前架构是**全量渲染模式**，依赖浏览器的 `content-visibility` 优化离屏渲染，但无法避免：

1. **DOM 节点数量过多** - 所有历史消息都在 DOM 树中
2. **Markdown 解析阻塞主线程** - 同步解析，没有缓存
3. **会话切换全量传输** - 一次性传输所有消息数据
4. **响应式系统开销** - Vue 的响应式追踪和 diff 成本

## 解决方案优先级

### 立即可做（最大收益/风险比）

#### 方案 A: Markdown 解析缓存
**改动点**: `MarkdownRenderer.vue`

```typescript
// 添加模块级缓存
const parseCache = new Map<string, string>()
const MAX_CACHE_SIZE = 200

function renderMarkdown() {
  const cacheKey = `${props.content}:${props.showCopyButton}`
  if (parseCache.has(cacheKey)) {
    renderedHtml.value = parseCache.get(cacheKey)!
    return
  }
  
  // ... 解析逻辑
  
  if (parseCache.size >= MAX_CACHE_SIZE) {
    const firstKey = parseCache.keys().next().value
    parseCache.delete(firstKey)
  }
  parseCache.set(cacheKey, renderedHtml.value)
}
```

**预期收益**: 切换会话时 Markdown 解析耗时从 500-1000ms 降到 0-50ms
**风险**: 低，缓存失效逻辑简单

#### 方案 B: 会话切换懒加载消息
**改动点**: `ChatService.ts` + `WebviewManager.ts`

```typescript
// 只发送最近 20 条消息 + 元数据
case 'session.load': {
  const loaded = this.chatService.loadSession(message.data.sessionId)
  if (loaded) {
    this.postMessage({
      type: 'session.restored',
      data: {
        session: {
          ...loaded,
          messages: loaded.messages.slice(-20), // 只发送最近 20 条
        },
        fullMessageCount: loaded.messages.length,
      },
    })
  }
  break
}

// Webview 滚动到顶部时请求更多
case 'session.load.more': {
  const offset = message.data.offset
  const limit = message.data.limit
  // 返回更多消息
}
```

**预期收益**: 切换会话数据传输耗时从 50-150ms 降到 10-30ms
**风险**: 中，需要实现滚动加载逻辑

### 中期方案（需要较大改动）

#### 方案 C: 虚拟滚动（最根本解决）
**原理**: 只渲染可视区域的消息，动态创建/销毁 DOM

**现有库**: 
- `vue-virtual-scroller` (推荐)
- `@tanstack/vue-virtual`

**改动点**: `MessageList.vue`

```vue
<template>
  <RecycleScroller
    :items="enhancedMessages"
    :item-size="120"
    :buffer="200"
    key-field="id"
  >
    <template #default="{ item }">
      <MessageItem :message="item" />
    </template>
  </RecycleScroller>
</template>
```

**预期收益**: 
- DOM 节点数从 1000+ 降到 20-30
- 切换会话渲染时间从 800ms 降到 50-100ms
- 滚动性能提升 10-50 倍

**风险**: 高
- 需要调试虚拟滚动库
- `content-visibility` 和虚拟滚动可能冲突
- 消息高度不固定（Markdown 内容长度不一），需要动态测量

#### 方案 D: Web Worker 异步解析 Markdown
**改动点**: 创建 `markdown-worker.ts`

```typescript
// markdown-worker.ts
import { marked } from 'marked'

self.onmessage = (e) => {
  const { id, content, options } = e.data
  const html = marked.parse(content, options)
  self.postMessage({ id, html })
}
```

**预期收益**: Markdown 解析不阻塞主线程
**风险**: 中等
- Worker 通信有序列化开销
- 需要管理 Worker 生命周期

### 长期方案（架构重构）

#### 方案 E: 消息流式传输
**原理**: 不一次性传输完整会话，而是流式发送

```typescript
// 先发送会话元数据
postMessage({ type: 'session.meta', data: { id, name, messageCount } })

// 再分批发送消息
for (let i = 0; i < messages.length; i += 10) {
  const batch = messages.slice(i, i + 10)
  postMessage({ type: 'session.messages.append', data: { batch } })
  await nextTick() // 让浏览器有机会渲染
}
```

**预期收益**: 用户更快看到首屏内容
**风险**: 高，需要重构消息管理逻辑

## 推荐实施顺序

1. **立即**: 方案 A (Markdown 缓存) - 1小时工作量，最大收益
2. **本周**: 方案 B (懒加载) - 4小时工作量，显著改善
3. **下周**: 方案 C (虚拟滚动) - 2天工作量，根本解决
4. **未来**: 方案 D + E (Worker + 流式) - 按需考虑

## 测试验证

### 性能指标
- 切换会话响应时间 < 200ms
- 滚动帧率 > 50fps
- 内存占用 < 200MB (100 条消息场景)

### 测试场景
1. 切换到 100 条消息的会话
2. 在长会话中快速滚动
3. 切换后立即滚动
4. 同时打开多个不同长度的会话

### 测试工具
- Chrome DevTools Performance 面板
- VSCode Webview DevTools
- Performance.now() 打点测量
