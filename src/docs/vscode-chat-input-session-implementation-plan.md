# VSCode 插件对话输入与会话功能实现方案

本文面向另一个 `Vue3 + TypeScript + Node` 的 VSCode 插件项目，目标是在 Webview 聊天界面中复刻现有桌面端对话输入能力：`/` 命令、`@` 文件引用、运行停止、图片/文件附件、提交协议。历史会话功能保留，但 UI 位置调整到头部右侧，点击后弹出历史会话记录，选择后切换会话。

## 1. 总体架构

### 1.1 推荐模块划分

```text
vscode-extension/
├─ src/
│  ├─ extension.ts
│  ├─ webview/
│  │  ├─ ChatPanelProvider.ts
│  │  ├─ messageBridge.ts
│  │  ├─ sessionService.ts
│  │  ├─ filesystemService.ts
│  │  ├─ commandService.ts
│  │  └─ agentRuntimeService.ts
│  └─ types/
│     └─ chat.ts
└─ webview-ui/
   └─ src/
      ├─ components/
      │  ├─ ChatHeader.vue
      │  ├─ ChatInput.vue
      │  ├─ SlashCommandMenu.vue
      │  ├─ FileSearchMenu.vue
      │  ├─ AttachmentGallery.vue
      │  ├─ ComposerDropOverlay.vue
      │  └─ HistorySessionPopover.vue
      ├─ stores/
      │  ├─ chatStore.ts
      │  ├─ sessionStore.ts
      │  └─ workspaceContextStore.ts
      ├─ api/
      │  └─ vscodeBridge.ts
      ├─ lib/
      │  ├─ composerUtils.ts
      │  ├─ composerAttachments.ts
      │  └─ time.ts
      └─ types/
         └─ chat.ts
```

### 1.2 通信方式

VSCode 插件环境不建议让 Webview 直接访问本地 Node API。推荐使用：

- Webview 前端：`vscode.postMessage()` 发送请求。
- Extension Host：`webview.onDidReceiveMessage()` 处理请求，调用 Node / VSCode API。
- Extension Host 再用 `webview.postMessage()` 推送响应和流式事件。

建议统一消息格式：

```ts
export interface WebviewRequest<T = unknown> {
  id: string
  type: string
  payload?: T
}

export interface ExtensionResponse<T = unknown> {
  id?: string
  type: string
  payload?: T
  error?: string
}
```

核心消息类型：

```ts
type WebviewToExtensionMessage =
  | { type: 'chat/sendMessage'; id: string; payload: SendMessagePayload }
  | { type: 'chat/stopGeneration'; id: string; payload: { sessionId: string } }
  | { type: 'commands/listSlashCommands'; id: string; payload: { sessionId?: string; workDir?: string } }
  | { type: 'filesystem/browse'; id: string; payload: { dirPath: string } }
  | { type: 'filesystem/search'; id: string; payload: { query: string; rootPath: string } }
  | { type: 'attachments/pickFiles'; id: string; payload?: { canSelectMany?: boolean } }
  | { type: 'sessions/list'; id: string; payload?: { limit?: number; offset?: number } }
  | { type: 'sessions/open'; id: string; payload: { sessionId: string } }
```

```ts
type ExtensionToWebviewMessage =
  | { type: 'chat/status'; payload: { sessionId: string; state: 'idle' | 'running' } }
  | { type: 'chat/assistantDelta'; payload: { sessionId: string; delta: string } }
  | { type: 'chat/toolEvent'; payload: unknown }
  | { type: 'chat/messageComplete'; payload: { sessionId: string } }
  | { type: 'sessions/changed'; payload?: undefined }
  | { type: 'response'; id: string; payload?: unknown; error?: string }
```

## 2. ChatInput 组件设计

### 2.1 状态

`ChatInput.vue` 需要维护：

```ts
const input = ref('')
const attachments = ref<ComposerAttachment[]>([])

const slashMenuOpen = ref(false)
const slashFilter = ref('')
const slashSelectedIndex = ref(0)
const slashTriggerStart = ref<number | null>(null)

const atMenuOpen = ref(false)
const atFilter = ref('')
const atTriggerStart = ref<number | null>(null)

const plusMenuOpen = ref(false)
const isDragActive = ref(false)
```

从 store 读取：

```ts
const chatState = computed(() => chatStore.activeSession?.state ?? 'idle')
const isRunning = computed(() => chatState.value !== 'idle')
const workspaceReferences = computed(() => workspaceContextStore.references)
```

### 2.2 输入变化

输入变化时同时检测 `/` 和 `@`，但二者互斥：

```ts
function handleInputChange(value: string, cursor: number) {
  input.value = value

  const slash = findSlashTrigger(value, cursor)
  if (slash) {
    slashMenuOpen.value = true
    slashFilter.value = slash.filter
    slashTriggerStart.value = slash.start
    slashSelectedIndex.value = 0
    atMenuOpen.value = false
    return
  }

  const at = findAtTrigger(value, cursor)
  if (at) {
    atMenuOpen.value = true
    atFilter.value = at.filter
    atTriggerStart.value = at.start
    slashMenuOpen.value = false
    return
  }

  slashMenuOpen.value = false
  atMenuOpen.value = false
}
```

## 3. `/` 命令实现

### 3.1 触发规则

实现 `findSlashTrigger`：

```ts
export function findSlashTrigger(value: string, cursor: number) {
  const beforeCursor = value.slice(0, cursor)
  const slashIndex = beforeCursor.lastIndexOf('/')
  if (slashIndex < 0) return null

  const prev = slashIndex === 0 ? '' : beforeCursor[slashIndex - 1]
  if (slashIndex > 0 && !/\s/.test(prev)) return null

  const filter = beforeCursor.slice(slashIndex + 1)
  if (/\s|\n/.test(filter)) return null

  return { start: slashIndex, filter }
}
```

行为要求：

- 只识别光标前最后一个 `/`。
- `/` 必须在行首或前一个字符为空白。
- `/` 后 filter 不能包含空白或换行。

### 3.2 命令来源

命令列表由三部分合并：

1. 后端 / Agent runtime 返回的 session 命令。
2. Webview 内置兜底命令。
3. 当前项目动态 Agent 命令，如果另一个项目也支持 agent 类型。

内置兜底命令建议：

```ts
export const FALLBACK_SLASH_COMMANDS = [
  { name: 'agent', description: 'Run a sub-agent', argumentHint: '<type>' },
  { name: 'mcp', description: 'Open MCP panel' },
  { name: 'skills', description: 'Open skills panel' },
  { name: 'help', description: 'Show help' },
  { name: 'status', description: 'Show current status' },
  { name: 'cost', description: 'Show usage cost' },
  { name: 'context', description: 'Show context usage' },
  { name: 'plugin', description: 'Open plugin settings' },
  { name: 'memory', description: 'Open memory settings' },
  { name: 'doctor', description: 'Run diagnostics' },
  { name: 'compact', description: 'Compact conversation' },
  { name: 'clear', description: 'Clear conversation' },
  { name: 'goal', description: 'Manage goals' },
]
```

合并时按 `name` 去重，后端命令优先，内置命令兜底。

### 3.3 过滤排序

```ts
export function filterSlashCommands(commands: SlashCommand[], filter: string) {
  const q = filter.trim().toLowerCase()
  if (!q) return commands

  return commands
    .map(command => {
      const name = command.name.toLowerCase()
      const description = command.description?.toLowerCase() ?? ''
      const argumentHint = command.argumentHint?.toLowerCase() ?? ''

      let score = 0
      if (name === q) score += 100
      else if (name.startsWith(q)) score += 80
      else if (name.includes(q)) score += 50
      if (description.includes(q)) score += 20
      if (argumentHint.includes(q)) score += 10

      return { command, score }
    })
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || a.command.name.localeCompare(b.command.name))
    .map(item => item.command)
}
```

### 3.4 键盘操作

`ChatInput.vue` 的 `keydown` 优先交给弹层：

- `ArrowDown`：选中下一项。
- `ArrowUp`：选中上一项。
- `Enter`：
  - 如果 filter 精确匹配命令，可以直接提交。
  - 否则补全当前选中命令。
- `Tab`：补全当前选中命令。
- `Escape`：关闭菜单。

补全命令时替换 trigger token：

```ts
function applySlashCommand(command: SlashCommand) {
  if (slashTriggerStart.value == null) return

  const textarea = textareaRef.value
  const cursor = textarea?.selectionStart ?? input.value.length
  const before = input.value.slice(0, slashTriggerStart.value)
  const after = input.value.slice(cursor)
  const inserted = `/${command.name}${command.argumentHint ? ' ' : ' '}`

  input.value = `${before}${inserted}${after}`
  slashMenuOpen.value = false

  nextTick(() => {
    const nextCursor = before.length + inserted.length
    textarea?.setSelectionRange(nextCursor, nextCursor)
    textarea?.focus()
  })
}
```

### 3.5 本地 UI 命令

这些命令不发给 Agent runtime，而是在 Webview 内处理：

```ts
const PANEL_COMMANDS = new Set(['mcp', 'skills', 'help', 'status', 'cost', 'context'])
const SETTINGS_COMMANDS = new Set(['config', 'plugin', 'memory', 'doctor'])
```

提交时判断：

```ts
function resolveLocalSlashAction(text: string) {
  const match = text.trim().match(/^\/([\w-]+)/)
  if (!match) return null

  const name = match[1]
  if (PANEL_COMMANDS.has(name)) return { type: 'panel', name }
  if (SETTINGS_COMMANDS.has(name)) return { type: 'settings', name }
  return null
}
```

处理策略：

- panel 命令：打开 Webview 内面板或 modal。
- settings 命令：通知 Extension Host 执行 VSCode command，例如打开设置页、插件配置页。
- 其他命令：作为普通消息发送给 Agent runtime。

## 4. `@` 文件引用实现

### 4.1 触发规则

```ts
export function findAtTrigger(value: string, cursor: number) {
  const beforeCursor = value.slice(0, cursor)
  const atIndex = beforeCursor.lastIndexOf('@')
  if (atIndex < 0) return null

  const prev = atIndex === 0 ? '' : beforeCursor[atIndex - 1]
  if (atIndex > 0 && !/\s/.test(prev)) return null

  const filter = beforeCursor.slice(atIndex + 1)
  if (/\s|\n/.test(filter)) return null

  return { start: atIndex, filter }
}
```

### 4.2 文件搜索菜单

`FileSearchMenu.vue` props：

```ts
interface FileSearchMenuProps {
  cwd: string
  query: string
}
```

加载规则：

- query 为空：调用 `filesystem/browse` 浏览当前目录。
- query 非空：调用 `filesystem/search` 搜索当前 workspace。

Extension Host 实现：

```ts
async function browse(dirPath: string) {
  const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(dirPath))
  return entries.map(([name, type]) => ({
    name,
    path: path.join(dirPath, name),
    type: type === vscode.FileType.Directory ? 'directory' : 'file',
  }))
}
```

搜索建议优先使用 VSCode API：

```ts
async function searchFiles(query: string) {
  const pattern = `**/*${query}*`
  const files = await vscode.workspace.findFiles(pattern, '**/{node_modules,.git,dist,build}/**', 100)
  return files.map(uri => ({
    name: path.basename(uri.fsPath),
    path: uri.fsPath,
    type: 'file',
  }))
}
```

### 4.3 选中文件后的处理

选中文件或目录后：

1. 删除输入框中的 `@xxx` token。
2. 不把路径直接保留在输入文本。
3. 写入 `workspaceContextStore.references`。
4. 在输入框上方显示 reference chip。
5. 提交时转成模型可见 prompt 和附件 payload。

reference 类型：

```ts
export interface WorkspaceReference {
  id: string
  type: 'file' | 'directory'
  name: string
  path: string
  relativePath: string
}
```

提交时追加上下文：

```ts
function formatWorkspaceReferencePrompt(references: WorkspaceReference[]) {
  if (!references.length) return ''

  return [
    '用户引用了以下工作区文件或目录：',
    ...references.map(ref => `- @${ref.relativePath}`),
  ].join('\n')
}
```

如果 Agent runtime 支持附件，建议同时传：

```ts
const referenceAttachments = references.map(ref => ({
  type: 'workspace_reference',
  path: ref.path,
  name: ref.name,
  referenceType: ref.type,
}))
```

## 5. 停止运行实现

### 5.1 Webview UI

发送按钮根据状态切换：

- `idle`：显示发送图标，点击提交。
- `running`：显示停止图标，点击停止。

```vue
<button @click="isRunning ? stopGeneration() : submit()">
  <span v-if="isRunning">stop</span>
  <span v-else>send</span>
</button>
```

### 5.2 前端 store

```ts
async function stopGeneration(sessionId: string) {
  await vscodeBridge.request('chat/stopGeneration', { sessionId })

  flushPendingDelta(sessionId)
  clearPendingToolInput(sessionId)
  setChatState(sessionId, 'idle')
  clearPermissionState(sessionId)
  stopElapsedTimer(sessionId)
}
```

### 5.3 Extension Host

Extension Host 需要维护每个 session 的运行控制器：

```ts
const runningSessions = new Map<string, {
  abortController: AbortController
  childProcess?: ChildProcess
}>()
```

处理停止：

```ts
async function stopGeneration(sessionId: string) {
  const running = runningSessions.get(sessionId)
  if (!running) {
    postStatus(sessionId, 'idle')
    return
  }

  running.abortController.abort()

  setTimeout(() => {
    const stillRunning = runningSessions.get(sessionId)
    if (stillRunning?.childProcess && !stillRunning.childProcess.killed) {
      stillRunning.childProcess.kill('SIGTERM')
    }
  }, 3000)

  postStatus(sessionId, 'idle')
}
```

如果底层 Agent SDK 支持 control channel，应优先发送 interrupt，再 3 秒后强制 kill，保持和现有桌面端一致。

## 6. 图片 / 文件附件实现

### 6.1 附件类型

```ts
export type ComposerAttachment =
  | {
      id: string
      type: 'image'
      name: string
      mimeType: string
      size: number
      data?: string
      previewUrl?: string
      path?: string
    }
  | {
      id: string
      type: 'file'
      name: string
      mimeType?: string
      size?: number
      data?: string
      path?: string
    }
```

### 6.2 粘贴图片

`textarea` 绑定 `paste`：

```ts
async function handlePaste(event: ClipboardEvent) {
  const items = Array.from(event.clipboardData?.items ?? [])
  const imageItems = items.filter(item => item.type.startsWith('image/'))
  if (!imageItems.length) return

  event.preventDefault()

  for (const item of imageItems) {
    const file = item.getAsFile()
    if (!file) continue
    attachments.value.push(await fileToComposerAttachment(file))
  }
}
```

### 6.3 点击添加文件

VSCode Webview 无法直接拿到真实本地路径，推荐让 Extension Host 调用 `vscode.window.showOpenDialog`：

Webview：

```ts
async function openAttachmentPicker() {
  const files = await vscodeBridge.request<ComposerAttachment[]>('attachments/pickFiles', {
    canSelectMany: true,
  })
  attachments.value.push(...files)
}
```

Extension Host：

```ts
async function pickFiles() {
  const uris = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: true,
  })

  return Promise.all((uris ?? []).map(async uri => {
    const stat = await vscode.workspace.fs.stat(uri)
    return {
      id: crypto.randomUUID(),
      type: isImagePath(uri.fsPath) ? 'image' : 'file',
      name: path.basename(uri.fsPath),
      path: uri.fsPath,
      size: stat.size,
      mimeType: guessMimeType(uri.fsPath),
    }
  }))
}
```

### 6.4 浏览器 file input 兜底

如果需要兼容纯 Web 环境，可以保留隐藏 input：

```vue
<input ref="fileInputRef" type="file" multiple class="hidden" @change="handleFileSelect" />
```

读取规则：

- 图片：读成 Data URL，展示 preview。
- 普通文件：读成 Data URL 或文本，按 runtime 支持情况决定。
- 在 VSCode 插件本地环境中，优先用 Extension Host 返回 `path`，避免大文件塞进 Webview 消息。

### 6.5 拖拽添加

Webview 拖拽文件可能拿不到真实路径，建议分两档：

1. 如果 `DataTransfer.files` 可读：按浏览器 File 读取。
2. 如果要支持本地真实路径：实现 VSCode command 或自定义 URI 方案，不建议依赖私有字段。

```ts
function handleDrop(event: DragEvent) {
  event.preventDefault()
  isDragActive.value = false

  const files = Array.from(event.dataTransfer?.files ?? [])
  appendFiles(files)
}
```

拖拽过程中显示 `ComposerDropOverlay.vue`。

### 6.6 提交附件

提交 payload：

```ts
export interface SendMessagePayload {
  sessionId: string
  content: string
  attachments: AttachmentRef[]
  options?: {
    workDir?: string
  }
}
```

附件转换：

```ts
function toAttachmentRef(attachment: ComposerAttachment): AttachmentRef {
  if (attachment.path) {
    return {
      type: attachment.type,
      name: attachment.name,
      path: attachment.path,
      mimeType: attachment.mimeType,
    }
  }

  return {
    type: attachment.type,
    name: attachment.name,
    data: attachment.data,
    mimeType: attachment.mimeType,
  }
}
```

发送成功后清理：

- `input = ''`
- `attachments = []`
- `workspaceReferences = []`
- 关闭 `/` 和 `@` 菜单

## 7. 历史会话实现，UI 放到头部右边

### 7.1 UI 位置

在 `ChatHeader.vue` 右侧放历史按钮：

```vue
<header class="chat-header">
  <div class="chat-title">当前会话</div>

  <div class="chat-header-actions">
    <button @click="historyOpen = !historyOpen">历史会话</button>
    <HistorySessionPopover
      v-if="historyOpen"
      :sessions="sessions"
      :active-session-id="activeSessionId"
      @select="openSession"
      @close="historyOpen = false"
    />
  </div>
</header>
```

### 7.2 交互要求

- 点击头部右侧按钮打开 popover。
- popover 内显示历史会话记录。
- 点击某条会话后：
  1. 关闭 popover。
  2. 调用 `sessions/open`。
  3. 更新 active session。
  4. 加载该会话消息。

### 7.3 列表字段

```ts
export interface SessionListItem {
  id: string
  title: string
  workDir?: string
  projectRoot?: string
  createdAt: string
  modifiedAt: string
  messageCount: number
}
```

### 7.4 加载与刷新

`sessionStore.ts`：

```ts
const sessions = ref<SessionListItem[]>([])

async function fetchSessions() {
  const result = await vscodeBridge.request<SessionListItem[]>('sessions/list', { limit: 400 })
  sessions.value = mergeAndSortSessions(result)
}

function mergeAndSortSessions(items: SessionListItem[]) {
  const map = new Map<string, SessionListItem>()
  for (const item of items) map.set(item.id, item)
  return [...map.values()].sort((a, b) => {
    return new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime()
  })
}
```

刷新时机：

- Webview 初始化时刷新。
- VSCode 窗口重新聚焦时由 Extension Host 推送 `sessions/changed` 或 Webview 主动刷新。
- 每 30 秒定时刷新一次。
- 避免 5 秒内重复刷新。

### 7.5 列表展示

`HistorySessionPopover.vue` 建议包含：

- 搜索框：按 title / workDir 过滤。
- 会话标题。
- 相对更新时间。
- 消息数。
- 当前选中态。

```vue
<div class="history-popover">
  <input v-model="query" placeholder="搜索历史会话" />

  <button
    v-for="session in filteredSessions"
    :key="session.id"
    class="history-item"
    :class="{ active: session.id === activeSessionId }"
    @click="$emit('select', session.id)"
  >
    <div class="title">{{ session.title }}</div>
    <div class="meta">{{ formatRelativeTime(session.modifiedAt) }} · {{ session.messageCount }} 条消息</div>
  </button>
</div>
```

### 7.6 后端统计来源

如果另一个项目已有 transcript / session 文件，按它的格式实现扫描；如果没有，建议采用 JSONL：

```json
{"type":"session-meta","sessionId":"...","title":"...","workDir":"...","timestamp":"..."}
{"type":"user","message":{"role":"user","content":"..."},"timestamp":"..."}
{"type":"assistant","message":{"role":"assistant","content":"..."},"timestamp":"..."}
```

统计规则保持一致：

- `createdAt`：第一条带 timestamp 的 entry，否则用文件 birthtime。
- `modifiedAt`：文件 mtime 或最后一条 timestamp。
- `messageCount`：`type` 是 `user` 或 `assistant` 且 `message.role` 存在。
- `title` 优先级：自定义标题 > meta title > 首条用户消息 > `Untitled Session`。
- `workDir`：meta workDir > 当前 workspace root。

读取时注意：

- 按 mtime 倒序。
- 支持 limit / offset。
- 大 JSONL 用 stream 逐行扫描。
- 列表结果可做 5 秒缓存。

## 8. 提交流程

`submit()` 执行顺序：

1. 如果当前 running，走 `stopGeneration()`。
2. trim 输入，检查附件和 workspace references。
3. 判断是否本地 slash command。
4. 如果是本地命令，打开本地 panel / settings，不发送给 Agent runtime。
5. 生成 workspace reference prompt。
6. 合并用户输入和 reference prompt。
7. 转换附件。
8. 调用 `chat/sendMessage`。
9. 本地插入 user message。
10. 状态置为 `running`。
11. 清空输入、附件、references。

示例：

```ts
async function submit() {
  if (isRunning.value) {
    await stopGeneration()
    return
  }

  const text = input.value.trim()
  if (!text && !attachments.value.length && !workspaceReferences.value.length) return

  const localAction = resolveLocalSlashAction(text)
  if (localAction) {
    runLocalSlashAction(localAction)
    input.value = ''
    return
  }

  const referencePrompt = formatWorkspaceReferencePrompt(workspaceReferences.value)
  const content = [text, referencePrompt].filter(Boolean).join('\n\n')
  const payloadAttachments = [
    ...attachments.value.map(toAttachmentRef),
    ...workspaceReferences.value.map(toWorkspaceReferenceAttachment),
  ]

  await chatStore.sendMessage(activeSessionId.value, content, payloadAttachments)

  input.value = ''
  attachments.value = []
  workspaceContextStore.clear()
  slashMenuOpen.value = false
  atMenuOpen.value = false
}
```

## 9. 样式与体验要求

### 9.1 输入区

- textarea 支持多行自适应高度。
- 上方显示附件 gallery 和 workspace reference chips。
- 左侧 `+` 打开菜单，包含：添加文件、插入 `/`。
- 右侧发送 / 停止按钮。
- 拖拽时显示半透明 overlay。

### 9.2 弹层

- `/` 菜单和 `@` 菜单出现在输入框上方。
- 支持鼠标点击和键盘选择。
- `Escape` 关闭。
- 弹层打开时不要提交表单。

### 9.3 历史会话 popover

- 位于头部右侧按钮下方。
- 宽度建议 320px 到 420px。
- 最大高度建议 60vh，内部滚动。
- 点击外部关闭。
- 切换会话前如果当前会话 running，建议先提示用户或自动 stop，避免状态混乱。

## 10. 实施步骤

### 阶段 1：基础通信与状态

1. 建立 Webview 与 Extension Host 的 request / response bridge。
2. 建立 `chatStore`、`sessionStore`、`workspaceContextStore`。
3. 实现 `chat/sendMessage` 和流式响应事件。
4. 实现 `chat/stopGeneration`。

验收：可以发送普通文本，收到流式回复，运行中可停止。

### 阶段 2：`/` 命令

1. 实现 `composerUtils.ts` 中的 slash trigger、merge、filter。
2. 实现 `SlashCommandMenu.vue`。
3. 实现键盘导航、Tab/Enter 补全、Escape 关闭。
4. 接入本地 UI 命令分流。
5. 接入 `commands/listSlashCommands`。

验收：`/` 后弹出命令，支持过滤、补全、本地命令处理。

### 阶段 3：`@` 文件引用

1. 实现 at trigger。
2. Extension Host 实现 `filesystem/browse` 和 `filesystem/search`。
3. 实现 `FileSearchMenu.vue`。
4. 选中文件后写入 workspace references。
5. 提交时转换为 prompt 和附件。

验收：`@` 后可搜索工作区文件，选择后显示 chip，提交时模型能收到引用信息。

### 阶段 4：附件

1. 实现附件类型和 `AttachmentGallery.vue`。
2. 支持粘贴图片。
3. 支持 VSCode open dialog 添加文件。
4. 支持 file input 兜底。
5. 支持拖拽添加。
6. 提交时转换附件 payload。

验收：图片可预览，文件可显示，发送时 runtime 能收到附件引用。

### 阶段 5：历史会话头部 popover

1. `ChatHeader.vue` 右侧添加历史按钮。
2. 实现 `HistorySessionPopover.vue`。
3. Extension Host 实现 `sessions/list`。
4. 实现 `sessions/open` 和会话消息加载。
5. 加入初始化、focus、定时刷新。

验收：点击头部右侧按钮出现历史会话列表，点击可切换会话。

### 阶段 6：测试与边界处理

1. 为 `findSlashTrigger`、`findAtTrigger`、`filterSlashCommands` 写单元测试。
2. 测试 slash 菜单键盘操作。
3. 测试 at 文件选择后 token 删除和 chip 添加。
4. 测试停止运行时状态恢复。
5. 测试历史会话排序、搜索、切换。
6. 测试图片粘贴、文件选择、拖拽。

## 11. 注意事项

- Webview 不要直接访问 Node API，所有文件系统、进程、会话扫描都放在 Extension Host。
- 大文件不要用 base64 直接塞进 Webview 消息，优先传 path，由 Extension Host / runtime 读取。
- 所有来自 Webview 的 path 都要校验是否在 workspace 或用户显式选择范围内。
- 停止运行要先优雅 interrupt，再延迟强制 kill。
- 历史会话扫描要流式读取，避免一次性读取大 JSONL。
- VSCode Webview 中 clipboard / drag-drop 的能力比 Electron 弱，真实路径获取优先通过 Extension Host open dialog。
- 本地 UI slash command 不要发给 Agent runtime，否则会产生不必要的模型调用。
