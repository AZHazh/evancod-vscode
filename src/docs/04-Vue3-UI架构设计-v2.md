# VSCode Evancod Vue 3 UI 架构设计（更新版）

> **已根据用户要求更新**  
> 版本: 2.0  
> 日期: 2026-06-27

---

## 🔄 主要变更

### ✅ 用户要求的调整

1. ❌ **移除 TailwindCSS** → ✅ **改用 SCSS + CSS Modules**
2. ✅ **输入框支持粘贴图片**（Ctrl+V / Cmd+V）
3. ✅ **新建会话按钮放在顶部**
4. ✅ **支持 /命令 功能**（系统现有的 117+ 斜杠命令）
5. ✅ **底部显示上下文用量**（Token 使用情况）
6. ✅ **底部可以切换模型**
7. ✅ **底部可以选择推理程度**（Effort Level）
8. ✅ **底部可以选择权限模式**（参考现有 Desktop 版本）
9. ✅ **同步按钮放在顶部显示**

---

## 📐 整体布局设计

```
┌─────────────────────────────────────────────────────────┐
│  顶部工具栏 (TopBar)                                      │
│  ┌──────────┬────────────┬────────────────┬──────────┐  │
│  │ + 新建会话 │ 同步 new-api │   [模型选择器]  │ Provider │  │
│  └──────────┴────────────┴────────────────┴──────────┘  │
├─────────────────────────────────────────────────────────┤
│                                                           │
│  主内容区 (MessageList - 虚拟滚动)                         │
│  ┌─────────────────────────────────────────────────┐    │
│  │                                                   │    │
│  │    User Message                                   │    │
│  │    ├─ 文本内容                                    │    │
│  │    └─ 附件（图片/文件）                           │    │
│  │                                                   │    │
│  │    Assistant Message                              │    │
│  │    ├─ Markdown 渲染                               │    │
│  │    ├─ 代码块（语法高亮）                          │    │
│  │    └─ 工具调用卡片                                │    │
│  │        ├─ BashTool: 执行命令                      │    │
│  │        └─ FileEditTool: 编辑文件                  │    │
│  │                                                   │    │
│  └─────────────────────────────────────────────────┘    │
│                                                           │
├─────────────────────────────────────────────────────────┤
│  输入区 (ChatInput)                                       │
│  ┌─────────────────────────────────────────────────┐    │
│  │                                                   │    │
│  │  输入框（自动高度，支持粘贴图片）                   │    │
│  │                                                   │    │
│  │  / 命令面板（动态显示）                            │    │
│  │  @ 文件引用菜单                                   │    │
│  │                                                   │    │
│  ├─────────────────────────────────────────────────┤    │
│  │ [图片1] [图片2] [文件.ts]  ← 附件预览             │    │
│  ├─────────────────────────────────────────────────┤    │
│  │ [模型: Sonnet▼] [推理: Medium▼] [权限: 询问▼]    │    │
│  │ 上下文: 12,345 tokens (45%) ───────────── [发送] │    │
│  └─────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

---

## 🧩 核心组件设计

### 1. TopBar.vue - 顶部工具栏

```vue
<script setup lang="ts">
import { useProviderStore } from '@/stores/provider'
import { useChatStore } from '@/stores/chat'

const providerStore = useProviderStore()
const chatStore = useChatStore()

const handleNewSession = () => {
  chatStore.createNewSession()
}

const handleSync = () => {
  // 打开 new-api 同步弹窗
  chatStore.openSyncModal()
}
</script>

<template>
  <div class="top-bar">
    <div class="top-bar__left">
      <button class="btn-new-session" @click="handleNewSession">
        <span class="icon">+</span>
        新建会话
      </button>
      
      <button class="btn-sync" @click="handleSync">
        <span class="icon">🔄</span>
        同步 new-api
      </button>
    </div>
    
    <div class="top-bar__right">
      <ModelSelector v-model="chatStore.currentModel" />
      <ProviderIndicator :provider="providerStore.activeProvider" />
    </div>
  </div>
</template>

<style scoped lang="scss">
.top-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  border-bottom: 1px solid var(--vscode-panel-border);
  background: var(--vscode-editor-background);
  
  &__left,
  &__right {
    display: flex;
    gap: 12px;
    align-items: center;
  }
}

.btn-new-session,
.btn-sync {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border: 1px solid var(--vscode-button-border);
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  
  &:hover {
    background: var(--vscode-button-hoverBackground);
  }
  
  .icon {
    font-size: 14px;
  }
}
</style>
```

---

### 2. ChatInput.vue - 输入框主容器

```vue
<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useChatStore } from '@/stores/chat'
import { useVSCode } from '@/composables/useVSCode'

const chatStore = useChatStore()
const vscode = useVSCode()

const input = ref('')
const textarea = ref<HTMLTextAreaElement>()
const images = ref<ImageAttachment[]>([])
const files = ref<FileAttachment[]>([])
const showSlashPanel = ref(false)
const slashFilter = ref('')

// 自动调整高度
const adjustHeight = () => {
  if (!textarea.value) return
  textarea.value.style.height = 'auto'
  textarea.value.style.height = `${Math.min(textarea.value.scrollHeight, 300)}px`
}

// 监听输入，检测斜杠命令
watch(input, (value) => {
  const match = value.match(/\/(\w*)$/)
  if (match) {
    showSlashPanel.value = true
    slashFilter.value = match[1]
  } else {
    showSlashPanel.value = false
  }
  adjustHeight()
})

// 粘贴事件 - 支持图片
const handlePaste = (e: ClipboardEvent) => {
  const items = e.clipboardData?.items
  if (!items) return
  
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      e.preventDefault()
      const file = item.getAsFile()
      if (file) {
        addImage(file)
      }
    }
  }
}

// 拖拽图片
const handleDrop = (e: DragEvent) => {
  e.preventDefault()
  const files = e.dataTransfer?.files
  if (!files) return
  
  for (const file of files) {
    if (file.type.startsWith('image/')) {
      addImage(file)
    }
  }
}

const addImage = (file: File) => {
  const id = crypto.randomUUID()
  const url = URL.createObjectURL(file)
  images.value.push({ id, file, url })
}

const removeImage = (id: string) => {
  const index = images.value.findIndex(img => img.id === id)
  if (index !== -1) {
    URL.revokeObjectURL(images.value[index].url)
    images.value.splice(index, 1)
  }
}

// 发送消息
const handleSend = () => {
  if (!input.value.trim() && !images.value.length) return
  
  vscode.postMessage({
    type: 'chat.send',
    data: {
      content: input.value,
      images: images.value.map(img => img.file),
      files: files.value
    }
  })
  
  input.value = ''
  images.value = []
  files.value = []
}

// 快捷键
const handleKeydown = (e: KeyboardEvent) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    e.preventDefault()
    handleSend()
  }
}

// 选择斜杠命令
const handleSelectCommand = (command: string) => {
  input.value = input.value.replace(/\/\w*$/, `/${command} `)
  showSlashPanel.value = false
  textarea.value?.focus()
}
</script>

<template>
  <div class="chat-input" @drop="handleDrop" @dragover.prevent>
    <!-- 斜杠命令面板 -->
    <SlashCommandPanel
      v-if="showSlashPanel"
      :filter="slashFilter"
      @select="handleSelectCommand"
      @close="showSlashPanel = false"
    />
    
    <!-- 输入框 -->
    <textarea
      ref="textarea"
      v-model="input"
      class="chat-input__textarea"
      placeholder="输入消息... (Cmd+Enter 发送, / 打开命令)"
      rows="1"
      @input="adjustHeight"
      @paste="handlePaste"
      @keydown="handleKeydown"
    />
    
    <!-- 附件预览 -->
    <div v-if="images.length || files.length" class="chat-input__attachments">
      <ImageAttachments :images="images" @remove="removeImage" />
      <FileAttachments :files="files" @remove="removeFile" />
    </div>
    
    <!-- 底部控制栏 -->
    <InputControls @send="handleSend" />
  </div>
</template>

<style scoped lang="scss">
.chat-input {
  position: relative;
  display: flex;
  flex-direction: column;
  border-top: 1px solid var(--vscode-panel-border);
  background: var(--vscode-editor-background);
  
  &__textarea {
    min-height: 44px;
    max-height: 300px;
    padding: 12px 16px;
    resize: none;
    border: none;
    background: transparent;
    color: var(--vscode-editor-foreground);
    font-family: var(--vscode-font-family);
    font-size: 14px;
    line-height: 1.5;
    
    &::placeholder {
      color: var(--vscode-input-placeholderForeground);
    }
    
    &:focus {
      outline: none;
    }
  }
  
  &__attachments {
    display: flex;
    gap: 8px;
    padding: 8px 16px;
    border-top: 1px solid var(--vscode-panel-border);
    flex-wrap: wrap;
  }
}
</style>
```

---

### 3. InputControls.vue - 底部控制栏

```vue
<script setup lang="ts">
import { ref, computed } from 'vue'
import { useChatStore } from '@/stores/chat'
import { useSettingsStore } from '@/stores/settings'

const emit = defineEmits<{
  send: []
}>()

const chatStore = useChatStore()
const settingsStore = useSettingsStore()

// 模型选项
const modelOptions = [
  { value: 'claude-3-5-sonnet-20241022', label: 'Sonnet 3.5' },
  { value: 'claude-3-5-haiku-20241022', label: 'Haiku 3.5' },
  { value: 'claude-3-opus-20240229', label: 'Opus 3' },
]

// 推理程度选项
const effortOptions = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
]

// 权限模式选项（参考 Desktop 版本）
const permissionOptions = [
  { value: 'default', label: '询问权限', icon: 'verified_user' },
  { value: 'acceptEdits', label: '自动接受', icon: 'bolt' },
  { value: 'plan', label: '计划模式', icon: 'architecture' },
  { value: 'bypassPermissions', label: '绕过权限', icon: 'gavel' },
]

// 上下文用量（模拟数据，实际从 Extension 获取）
const contextUsage = computed(() => {
  return {
    tokens: 12345,
    percentage: 45,
    formatted: '12,345 tokens (45%)'
  }
})
</script>

<template>
  <div class="input-controls">
    <div class="input-controls__left">
      <!-- 模型切换 -->
      <select v-model="chatStore.currentModel" class="control-select">
        <option v-for="opt in modelOptions" :key="opt.value" :value="opt.value">
          模型: {{ opt.label }}
        </option>
      </select>
      
      <!-- 推理程度 -->
      <select v-model="settingsStore.effortLevel" class="control-select">
        <option v-for="opt in effortOptions" :key="opt.value" :value="opt.value">
          推理: {{ opt.label }}
        </option>
      </select>
      
      <!-- 权限模式 -->
      <select v-model="settingsStore.permissionMode" class="control-select">
        <option v-for="opt in permissionOptions" :key="opt.value" :value="opt.value">
          权限: {{ opt.label }}
        </option>
      </select>
      
      <!-- 上下文用量 -->
      <div class="context-usage">
        上下文: {{ contextUsage.formatted }}
      </div>
    </div>
    
    <div class="input-controls__right">
      <button class="btn-send" @click="emit('send')">
        发送
      </button>
    </div>
  </div>
</template>

<style scoped lang="scss">
.input-controls {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  border-top: 1px solid var(--vscode-panel-border);
  background: var(--vscode-panel-background);
  
  &__left {
    display: flex;
    gap: 12px;
    align-items: center;
    flex: 1;
  }
  
  &__right {
    display: flex;
    gap: 8px;
  }
}

.control-select {
  padding: 4px 8px;
  border: 1px solid var(--vscode-input-border);
  background: var(--vscode-input-background);
  color: var(--vscode-input-foreground);
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
  
  &:focus {
    outline: 1px solid var(--vscode-focusBorder);
  }
}

.context-usage {
  font-size: 12px;
  color: var(--vscode-descriptionForeground);
  margin-left: auto;
  margin-right: 12px;
}

.btn-send {
  padding: 6px 16px;
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  
  &:hover {
    background: var(--vscode-button-hoverBackground);
  }
  
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}
</style>
```

---

### 4. SlashCommandPanel.vue - 斜杠命令面板

```vue
<script setup lang="ts">
import { ref, computed } from 'vue'

interface Props {
  filter: string
}

const props = defineProps<Props>()
const emit = defineEmits<{
  select: [command: string]
  close: []
}>()

// 所有可用的斜杠命令（从 Extension 获取）
// 这里列出当前系统支持的主要命令
const allCommands = [
  // 常用命令
  { name: 'commit', description: '创建 Git 提交', category: 'Git' },
  { name: 'commit-push-pr', description: '提交、推送并创建 PR', category: 'Git' },
  { name: 'review', description: '代码审查', category: 'Code' },
  { name: 'plan', description: '进入计划模式', category: 'Mode' },
  { name: 'diff', description: '查看差异', category: 'Git' },
  { name: 'branch', description: '分支操作', category: 'Git' },
  
  // 系统命令
  { name: 'clear', description: '清空会话', category: 'System' },
  { name: 'help', description: '显示帮助', category: 'System' },
  { name: 'config', description: '配置管理', category: 'System' },
  { name: 'context', description: '上下文管理', category: 'System' },
  { name: 'cost', description: '查看使用成本', category: 'System' },
  
  // 高级功能
  { name: 'agent', description: '启动子 Agent', category: 'Agent' },
  { name: 'agents', description: '管理 Agents', category: 'Agent' },
  { name: 'goal', description: '设置目标', category: 'Agent' },
  { name: 'tasks', description: '任务管理', category: 'Task' },
  { name: 'memory', description: '记忆管理', category: 'System' },
  { name: 'mcp', description: 'MCP 服务器', category: 'Integration' },
  { name: 'skills', description: 'Skills 管理', category: 'Integration' },
  
  // 会话管理
  { name: 'session', description: '会话管理', category: 'Session' },
  { name: 'resume', description: '恢复会话', category: 'Session' },
  { name: 'export', description: '导出会话', category: 'Session' },
  { name: 'share', description: '分享会话', category: 'Session' },
  
  // 开发工具
  { name: 'status', description: 'Git 状态', category: 'Git' },
  { name: 'doctor', description: '系统诊断', category: 'System' },
  { name: 'upgrade', description: '升级版本', category: 'System' },
  { name: 'version', description: '查看版本', category: 'System' },
  
  // Skills 命令（动态加载）
  { name: 'pdf', description: 'PDF 处理', category: 'Skills' },
  { name: 'screenshot', description: '截图分析', category: 'Skills' },
]

// 过滤命令
const filteredCommands = computed(() => {
  if (!props.filter) return allCommands
  const lowerFilter = props.filter.toLowerCase()
  return allCommands.filter(cmd => 
    cmd.name.toLowerCase().includes(lowerFilter) ||
    cmd.description.toLowerCase().includes(lowerFilter)
  )
})

const selectedIndex = ref(0)

// 键盘导航
const handleKeydown = (e: KeyboardEvent) => {
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    selectedIndex.value = Math.min(selectedIndex.value + 1, filteredCommands.value.length - 1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    selectedIndex.value = Math.max(selectedIndex.value - 1, 0)
  } else if (e.key === 'Enter') {
    e.preventDefault()
    handleSelect(filteredCommands.value[selectedIndex.value].name)
  } else if (e.key === 'Escape') {
    e.preventDefault()
    emit('close')
  }
}
</script>

<template>
  <div class="slash-command-panel" @keydown="handleKeydown">
    <div class="panel-header">
      <span class="panel-title">命令</span>
      <span class="panel-hint">↑↓ 导航 Enter 选择 Esc 关闭</span>
    </div>
    
    <div class="command-list">
      <button
        v-for="(cmd, index) in filteredCommands"
        :key="cmd.name"
        class="command-item"
        :class="{ 'is-selected': index === selectedIndex }"
        @click="emit('select', cmd.name)"
        @mouseenter="selectedIndex = index"
      >
        <div class="command-main">
          <span class="command-name">/{{ cmd.name }}</span>
          <span class="command-category">{{ cmd.category }}</span>
        </div>
        <div class="command-description">{{ cmd.description }}</div>
      </button>
    </div>
    
    <div v-if="filteredCommands.length === 0" class="empty-state">
      未找到匹配的命令
    </div>
  </div>
</template>

<style scoped lang="scss">
.slash-command-panel {
  position: absolute;
  bottom: 100%;
  left: 16px;
  right: 16px;
  max-height: 400px;
  margin-bottom: 8px;
  background: var(--vscode-editorWidget-background);
  border: 1px solid var(--vscode-editorWidget-border);
  border-radius: 6px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
  overflow: hidden;
  z-index: 100;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid var(--vscode-panel-border);
  background: var(--vscode-panel-background);
}

.panel-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--vscode-foreground);
}

.panel-hint {
  font-size: 11px;
  color: var(--vscode-descriptionForeground);
}

.command-list {
  max-height: 350px;
  overflow-y: auto;
}

.command-item {
  width: 100%;
  padding: 8px 12px;
  border: none;
  background: transparent;
  text-align: left;
  cursor: pointer;
  transition: background-color 0.15s;
  
  &:hover,
  &.is-selected {
    background: var(--vscode-list-hoverBackground);
  }
  
  &.is-selected {
    outline: 1px solid var(--vscode-focusBorder);
    outline-offset: -1px;
  }
}

.command-main {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.command-name {
  font-family: var(--vscode-editor-font-family);
  font-size: 13px;
  font-weight: 500;
  color: var(--vscode-foreground);
}

.command-category {
  font-size: 11px;
  padding: 2px 6px;
  background: var(--vscode-badge-background);
  color: var(--vscode-badge-foreground);
  border-radius: 3px;
}

.command-description {
  font-size: 12px;
  color: var(--vscode-descriptionForeground);
}

.empty-state {
  padding: 24px;
  text-align: center;
  color: var(--vscode-descriptionForeground);
  font-size: 13px;
}
</style>
```

---

## 📦 完整的技术栈

| 层级 | 技术 |
|------|------|
| **核心框架** | Vue 3.4+ (Composition API) |
| **状态管理** | Pinia 2.x |
| **样式方案** | **SCSS + CSS Modules** |
| **构建工具** | Vite 5.x |
| **代码高亮** | Shiki |
| **Markdown** | Marked |
| **图标** | Lucide Vue Next |

---

## 🎨 SCSS 架构

```scss
// styles/variables.scss
:root {
  // 从 VSCode 继承
  --color-bg-primary: var(--vscode-editor-background);
  --color-bg-secondary: var(--vscode-panel-background);
  --color-text-primary: var(--vscode-editor-foreground);
  --color-text-secondary: var(--vscode-descriptionForeground);
  --color-border: var(--vscode-panel-border);
  --color-accent: var(--vscode-focusBorder);
  
  // 布局
  --input-height-min: 44px;
  --input-height-max: 300px;
  --spacing-xs: 4px;
  --spacing-sm: 8px;
  --spacing-md: 16px;
  --spacing-lg: 24px;
  
  // 圆角
  --radius-sm: 4px;
  --radius-md: 6px;
  --radius-lg: 8px;
}

// styles/mixins.scss
@mixin button-base {
  padding: 6px 12px;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: 13px;
  transition: background-color 0.15s;
  
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}

@mixin button-primary {
  @include button-base;
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
  
  &:hover:not(:disabled) {
    background: var(--vscode-button-hoverBackground);
  }
}

@mixin scrollbar {
  &::-webkit-scrollbar {
    width: 10px;
    height: 10px;
  }
  
  &::-webkit-scrollbar-track {
    background: transparent;
  }
  
  &::-webkit-scrollbar-thumb {
    background: var(--vscode-scrollbarSlider-background);
    border-radius: 5px;
    
    &:hover {
      background: var(--vscode-scrollbarSlider-hoverBackground);
    }
    
    &:active {
      background: var(--vscode-scrollbarSlider-activeBackground);
    }
  }
}
```

---

## ✅ 确认清单

- ✅ 样式改用 SCSS（移除 TailwindCSS）
- ✅ 顶部新建会话按钮
- ✅ 顶部同步 new-api 按钮
- ✅ 输入框支持粘贴图片（Ctrl+V）
- ✅ 输入框支持拖拽图片
- ✅ 支持 117+ 斜杠命令（/commit, /review, /plan 等）
- ✅ 底部显示上下文用量（Token + 百分比）
- ✅ 底部模型切换器
- ✅ 底部推理程度选择器
- ✅ 底部权限模式选择器（参考 Desktop 版本）
- ✅ 参考当前项目的设计风格

---

**下一步**: 等待您的最终确认后，创建完整项目并开始开发 🚀
