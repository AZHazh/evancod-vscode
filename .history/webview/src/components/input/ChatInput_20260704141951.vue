<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import {
  ArrowRight,
  AtSign,
  Bot,
  Check,
  ChevronDown,
  Gauge,
  Hammer,
  Paperclip,
  Plus,
  ShieldCheck,
  Slash,
  Square,
  Zap,
} from 'lucide-vue-next'
import { useChatStore } from '@/stores/chat'
import { useProviderStore } from '@/stores/provider'
import Button from '@/components/common/Button.vue'
import SlashCommandMenu from './SlashCommandMenu.vue'
import FileSearchMenu from './FileSearchMenu.vue'
import AttachmentGallery from './AttachmentGallery.vue'
import ComposerDropOverlay from './ComposerDropOverlay.vue'
import { useVSCode } from '@/composables/useVSCode'
import type { EffortLevel, PermissionMode } from '@/stores/provider'
import type { ComposerAttachment, FileSearchEntry, SlashCommand, WorkspaceReference } from '@/types'
import {
  filterSlashCommands,
  findAtTrigger,
  findSlashTrigger,
  formatWorkspaceReferencePrompt,
  mergeSlashCommands,
  normalizeSlashCommand,
} from '@/lib/composerUtils'
import { composerAttachmentToPayload, createId, fileToComposerAttachment, workspaceReferenceToPayload } from '@/lib/composerAttachments'

const chatStore = useChatStore()
const providerStore = useProviderStore()
const vscode = useVSCode()
const input = ref('')
const textarea = ref<HTMLTextAreaElement>()
const openPanel = ref<'add' | 'permission' | 'model' | 'context' | 'slash' | 'at' | null>(null)
const attachments = ref<ComposerAttachment[]>([])
const workspaceReferences = ref<WorkspaceReference[]>([])
const slashCommands = ref<SlashCommand[]>(mergeSlashCommands([]))
const slashFilter = ref('')
const slashSelectedIndex = ref(0)
const slashTriggerStart = ref<number | null>(null)
const atFilter = ref('')
const atSelectedIndex = ref(0)
const atTriggerStart = ref<number | null>(null)
const fileEntries = ref<FileSearchEntry[]>([])
const isDragActive = ref(false)

const permissionOptions = [
  { value: 'default', label: '询问权限', desc: 'CLI 请求时确认文件编辑和高风险命令', icon: ShieldCheck },
  { value: 'acceptEdits', label: '自动接受编辑', desc: 'Evancod 无需询问即可写入磁盘', icon: Zap },
  { value: 'plan', label: '计划模式', desc: '仅架构和推理，不操作文件', icon: Bot },
  { value: 'bypassPermissions', label: '跳过权限', desc: '对 Shell 和文件系统的完整工具访问', icon: Hammer },
] as const

const contextWindow = computed(() => providerStore.activeProvider?.modelContextWindows?.[providerStore.currentModel] || providerStore.activeProvider?.autoCompactWindow || 200000)
const usage = computed(() => chatStore.tokenUsage)
const inputTokens = computed(() => usage.value?.inputTokens || 0)
const cacheReadTokens = computed(() => usage.value?.cacheReadTokens || 0)
const outputTokens = computed(() => usage.value?.outputTokens || 0)
const usedTokens = computed(() => inputTokens.value + outputTokens.value)
const remainingTokens = computed(() => Math.max(contextWindow.value - usedTokens.value, 0))
const contextPercent = computed(() => contextWindow.value ? Math.min(Math.round((usedTokens.value / contextWindow.value) * 100), 100) : 0)
const currentPermission = computed(() => permissionOptions.find(option => option.value === providerStore.permissionMode) || permissionOptions[0])
const selectedModelOption = computed(() => providerStore.modelOptions.find(option => option.model === providerStore.currentModel))
const providerGroups = computed(() => providerStore.providers.map(provider => ({
  provider,
  models: [
    { kind: 'main', model: provider.models.main },
    { kind: 'sonnet', model: provider.models.sonnet },
    { kind: 'opus', model: provider.models.opus },
    { kind: 'haiku', model: provider.models.haiku },
  ].filter((item, index, items) => item.model && items.findIndex(candidate => candidate.model === item.model) === index),
})))
const modelLabel = computed(() => selectedModelOption.value?.model || providerStore.currentModel)
const providerLabel = computed(() => providerStore.activeProvider?.name || '未配置')
const isRunning = computed(() => ['thinking', 'running', 'waiting_permission'].includes(chatStore.chatState))
const canSend = computed(() => isRunning.value || Boolean(input.value.trim() || attachments.value.length || workspaceReferences.value.length))
const filteredSlashCommands = computed(() => filterSlashCommands(slashCommands.value, slashFilter.value))

watch(atFilter, filter => {
  vscode.postMessage({
    type: filter ? 'filesystem.search' : 'filesystem.browse',
    data: filter ? { query: filter } : {},
  })
})

const adjustHeight = () => {
  if (!textarea.value) return
  textarea.value.style.height = 'auto'
  textarea.value.style.height = `${Math.min(textarea.value.scrollHeight, 300)}px`
}

function handleInput() {
  adjustHeight()
  const cursor = textarea.value?.selectionStart ?? input.value.length
  const slash = findSlashTrigger(input.value, cursor)
  if (slash) {
    slashFilter.value = slash.filter
    slashTriggerStart.value = slash.start
    slashSelectedIndex.value = 0
    openPanel.value = 'slash'
    return
  }

  const at = findAtTrigger(input.value, cursor)
  if (at) {
    atFilter.value = at.filter
    atTriggerStart.value = at.start
    atSelectedIndex.value = 0
    openPanel.value = 'at'
    vscode.postMessage({
      type: at.filter ? 'filesystem.search' : 'filesystem.browse',
      data: at.filter ? { query: at.filter } : {},
    })
    return
  }

  if (openPanel.value === 'slash' || openPanel.value === 'at') openPanel.value = null
}

function handleSend() {
  if (isRunning.value) {
    chatStore.stopGeneration()
    return
  }

  const text = input.value.trim()
  if (!text && !attachments.value.length && !workspaceReferences.value.length) return

  const referencePrompt = formatWorkspaceReferencePrompt(workspaceReferences.value)
  const content = [text, referencePrompt].filter(Boolean).join('\n\n')
  const files = [
    ...attachments.value.map(composerAttachmentToPayload),
    ...workspaceReferences.value.map(workspaceReferenceToPayload),
  ]

  chatStore.sendMessage(content, files)
  input.value = ''
  attachments.value = []
  workspaceReferences.value = []
  openPanel.value = null
  nextTick(adjustHeight)
}

function handleKeydown(event: KeyboardEvent) {
  if (openPanel.value === 'slash') {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const direction = event.key === 'ArrowDown' ? 1 : -1
      slashSelectedIndex.value = (slashSelectedIndex.value + direction + filteredSlashCommands.value.length) % Math.max(filteredSlashCommands.value.length, 1)
      return
    }
    if (event.key === 'Tab' || event.key === 'Enter') {
      event.preventDefault()
      const exact = filteredSlashCommands.value.find(command => command.name === slashFilter.value)
      const selected = exact || filteredSlashCommands.value[slashSelectedIndex.value]
      if (selected) applySlashCommand(selected)
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      openPanel.value = null
      return
    }
  }

  if (openPanel.value === 'at') {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const direction = event.key === 'ArrowDown' ? 1 : -1
      atSelectedIndex.value = (atSelectedIndex.value + direction + fileEntries.value.length) % Math.max(fileEntries.value.length, 1)
      return
    }
    if (event.key === 'Tab' || event.key === 'Enter') {
      event.preventDefault()
      const selected = fileEntries.value[atSelectedIndex.value]
      if (selected) applyFileReference(selected)
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      openPanel.value = null
      return
    }
  }

  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
    event.preventDefault()
    handleSend()
  }
}

function togglePanel(panel: typeof openPanel.value) {
  openPanel.value = openPanel.value === panel ? null : panel
}

function applySlashCommand(command: SlashCommand) {
  const normalized = normalizeSlashCommand(command)
  if (normalized.name === 'context') {
    openPanel.value = 'context'
    return
  }

  if (slashTriggerStart.value == null) return
  const cursor = textarea.value?.selectionStart ?? input.value.length
  const before = input.value.slice(0, slashTriggerStart.value)
  const after = input.value.slice(cursor)
  const inserted = `/${normalized.name} `
  input.value = `${before}${inserted}${after}`
  openPanel.value = null
  nextTick(() => {
    const nextCursor = before.length + inserted.length
    textarea.value?.setSelectionRange(nextCursor, nextCursor)
    textarea.value?.focus()
    adjustHeight()
  })
}

function applyFileReference(entry: FileSearchEntry) {
  if (atTriggerStart.value == null) return
  const cursor = textarea.value?.selectionStart ?? input.value.length
  const before = input.value.slice(0, atTriggerStart.value)
  const after = input.value.slice(cursor)
  input.value = `${before}${after}`
  if (!workspaceReferences.value.some(reference => reference.path === entry.path)) {
    workspaceReferences.value.push({
      id: createId(),
      type: entry.type,
      name: entry.name,
      path: entry.path,
      relativePath: entry.relativePath,
    })
  }
  openPanel.value = null
  nextTick(() => {
    textarea.value?.setSelectionRange(before.length, before.length)
    textarea.value?.focus()
    adjustHeight()
  })
}

function selectPermission(mode: PermissionMode) {
  providerStore.setPermissionMode(mode)
  openPanel.value = null
}

function selectEffortLevel(level: EffortLevel) {
  providerStore.setEffortLevel(level)
}

function selectModel(providerId: string, model: string) {
  if (providerStore.activeProviderId !== providerId) providerStore.activateProvider(providerId)
  providerStore.setModel(model)
  openPanel.value = null
}

function pickLocalFiles() {
  vscode.postMessage({ type: 'file.pick' })
  openPanel.value = null
}

async function appendFiles(files: File[]) {
  const converted = await Promise.all(files.map(fileToComposerAttachment))
  attachments.value.push(...converted)
}

async function handlePaste(event: ClipboardEvent) {
  const files = Array.from(event.clipboardData?.items ?? [])
    .filter(item => item.type.startsWith('image/'))
    .map(item => item.getAsFile())
    .filter((file): file is File => !!file)
  if (!files.length) return
  event.preventDefault()
  await appendFiles(files)
}

function handleDrop(event: DragEvent) {
  event.preventDefault()
  isDragActive.value = false
  const files = Array.from(event.dataTransfer?.files ?? [])
  void appendFiles(files)
}

function handleMessage(event: MessageEvent) {
  const message = event.data
  if (message.type === 'file.picked') {
    for (const file of message.data.files || []) {
      attachments.value.push({
        id: createId(),
        type: 'file',
        path: file.path,
        name: file.name || file.path,
        size: 0,
      })
    }
  }

  if (message.type === 'slash.commands') {
    slashCommands.value = mergeSlashCommands(message.data.commands || [])
  }

  if (message.type === 'filesystem.search.results' || message.type === 'filesystem.browse.results') {
    fileEntries.value = message.data.entries || []
    atSelectedIndex.value = 0
  }
}

onMounted(() => {
  window.addEventListener('message', handleMessage)
  vscode.postMessage({ type: 'slash.commands.request' })
})
onUnmounted(() => window.removeEventListener('message', handleMessage))
</script>

<template>
  <div class="composer-wrap">
    <div
      class="chat-input"
      :class="{ focused: openPanel }"
      @dragenter.prevent="isDragActive = true"
      @dragover.prevent="isDragActive = true"
      @dragleave.prevent="isDragActive = false"
      @drop="handleDrop"
    >
      <ComposerDropOverlay v-if="isDragActive" />
      <AttachmentGallery
        :attachments="attachments"
        :references="workspaceReferences"
        @remove-attachment="attachments = attachments.filter(item => item.id !== $event)"
        @remove-reference="workspaceReferences = workspaceReferences.filter(item => item.id !== $event)"
      />

      <textarea
        ref="textarea"
        v-model="input"
        class="chat-input__textarea"
        placeholder="让 Evancod 编辑、调试或解释代码..."
        rows="1"
        @input="handleInput"
        @keydown="handleKeydown"
        @paste="handlePaste"
      />

      <div class="chat-input__controls">
        <div class="controls-left">
          <button class="icon-trigger add-trigger" :class="{ active: openPanel === 'add' }" @click="togglePanel('add')">
            <Plus />
          </button>

          <button class="pill-trigger permission-trigger" :class="{ active: openPanel === 'permission' }" @click="togglePanel('permission')">
            <component :is="currentPermission.icon" />
            {{ currentPermission.label }}
            <ChevronDown />
          </button>
        </div>

        <div class="controls-right">
          <button class="context-pill" :class="{ active: openPanel === 'context' }" @click="togglePanel('context')">
            <Gauge /> {{ contextPercent }}%
          </button>

          <button class="pill-trigger model-trigger" :class="{ active: openPanel === 'model' }" @click="togglePanel('model')">
            {{ modelLabel }}
            <span>{{ providerLabel }}</span>
            <ChevronDown />
          </button>

          <Button variant="primary" size="medium" :disabled="!canSend" @click="handleSend">
            <template #icon><Square v-if="isRunning" /><ArrowRight v-else /></template>
            {{ isRunning ? '停止' : '运行' }}
          </Button>
        </div>
      </div>

      <div v-if="openPanel === 'add'" class="floating-panel add-panel">
        <button class="menu-row file-menu-row" @click="pickLocalFiles">
          <Paperclip />
          <span>添加文件或图片</span>
        </button>
        <button class="menu-row" @click="openPanel = 'at'; atFilter = ''; vscode.postMessage({ type: 'filesystem.browse', data: {} })">
          <AtSign />
          <span>@ 选择工作区文件</span>
        </button>
        <button class="menu-row" @click="openPanel = 'slash'">
          <Slash />
          <span>斜杠命令</span>
        </button>
      </div>

      <div v-if="openPanel === 'permission'" class="floating-panel permission-panel">
        <div class="panel-title">执行权限</div>
        <button
          v-for="option in permissionOptions"
          :key="option.value"
          class="permission-row"
          :class="{ selected: providerStore.permissionMode === option.value }"
          @click="selectPermission(option.value)"
        >
          <component :is="option.icon" />
          <span>
            <strong>{{ option.label }}</strong>
            <small>{{ option.desc }}</small>
          </span>
          <Check v-if="providerStore.permissionMode === option.value" class="check-icon" />
        </button>
      </div>

      <div v-if="openPanel === 'model'" class="floating-panel model-panel">
        <div class="panel-title">模型配置</div>
        <div v-for="group in providerGroups" :key="group.provider.id" class="model-group">
          <div class="group-title">
            {{ group.provider.name }}
            <span v-if="group.provider.id === providerStore.activeProviderId">默认</span>
          </div>
          <button
            v-for="option in group.models"
            :key="`${group.provider.id}-${option.kind}`"
            class="model-row"
            :class="{ selected: group.provider.id === providerStore.activeProviderId && option.model === providerStore.currentModel }"
            @click="selectModel(group.provider.id, option.model)"
          >
            <span class="radio-dot" />
            <span>
              <strong>{{ option.model }}</strong>
              <small>{{ option.kind }} 模型 · {{ group.provider.apiFormat }}</small>
            </span>
          </button>
        </div>

        <div class="effort-box">
          <div class="panel-title">推理强度</div>
          <div class="effort-options">
            <button :class="{ selected: providerStore.effortLevel === 'low' }" @click="selectEffortLevel('low')">低</button>
            <button :class="{ selected: providerStore.effortLevel === 'medium' }" @click="selectEffortLevel('medium')">中</button>
            <button :class="{ selected: providerStore.effortLevel === 'high' }" @click="selectEffortLevel('high')">高</button>
            <button :class="{ selected: providerStore.effortLevel === 'max' }" @click="selectEffortLevel('max')">最大</button>
          </div>
        </div>
      </div>

      <div v-if="openPanel === 'context'" class="floating-panel context-panel">
        <div class="context-head">
          <span>上下文<br><strong>{{ modelLabel }}</strong></span>
          <strong>{{ contextPercent }}%</strong>
        </div>
        <div class="context-grid">
          <span>已使用<br><strong>{{ usedTokens.toLocaleString() }}</strong></span>
          <span>剩余<br><strong>{{ remainingTokens.toLocaleString() }}</strong></span>
          <span>窗口<br><strong>{{ contextWindow.toLocaleString() }}</strong></span>
        </div>
        <div class="meter-row"><span>Input tokens</span><em>{{ inputTokens.toLocaleString() }}</em></div>
        <div class="meter"><i :style="{ width: `${Math.min(contextPercent, 100)}%` }" /></div>
        <div class="meter-row"><span>Cache read</span><em>{{ cacheReadTokens.toLocaleString() }}</em></div>
        <div class="meter blue"><i :style="{ width: `${Math.min(Math.round((cacheReadTokens / contextWindow) * 100), 100)}%` }" /></div>
        <div class="meter-row"><span>Output tokens</span><em>{{ outputTokens.toLocaleString() }}</em></div>
        <div class="meter"><i :style="{ width: `${Math.min(Math.round((outputTokens / contextWindow) * 100), 100)}%` }" /></div>
      </div>

      <div v-if="openPanel === 'slash'" class="floating-panel slash-panel">
        <SlashCommandMenu :commands="filteredSlashCommands" :selected-index="slashSelectedIndex" @hover="slashSelectedIndex = $event" @select="applySlashCommand" />
      </div>

      <div v-if="openPanel === 'at'" class="floating-panel at-panel">
        <FileSearchMenu :entries="fileEntries" :selected-index="atSelectedIndex" @hover="atSelectedIndex = $event" @select="applyFileReference" />
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.composer-wrap {
  position: relative;
  margin: 0 20px 16px;
  flex-shrink: 0;
}

.chat-input {
  position: relative;
  display: flex;
  flex-direction: column;
  border: 1px solid color-mix(in srgb, var(--vscode-focusBorder) 46%, var(--color-border));
  border-radius: 18px;
  background: color-mix(in srgb, var(--color-surface-container) 86%, transparent);
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.34);
  overflow: visible;

  &.focused,
  &:focus-within {
    border-color: color-mix(in srgb, var(--vscode-focusBorder) 72%, #ffad99);
  }

  &__textarea {
    min-height: 74px;
    max-height: 300px;
    padding: 22px 18px 16px;
    resize: none;
    border: none;
    background: transparent;
    color: var(--color-text-primary);
    font-family: var(--vscode-font-family);
    font-size: 14px;
    line-height: 1.55;

    &::placeholder { color: var(--vscode-input-placeholderForeground, var(--color-text-tertiary)); }
    &:focus { outline: none; }
  }

  &__controls {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 10px 12px;
    border-top: 1px solid color-mix(in srgb, var(--color-border) 64%, transparent);
    background: color-mix(in srgb, var(--color-surface) 54%, transparent);
    border-radius: 0 0 18px 18px;
  }
}

.icon-trigger,
.pill-trigger,
.context-pill {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  border: 1px solid transparent;
  color: var(--color-text-primary);
  background: transparent;
  border-radius: 999px;
  cursor: pointer;
}

.icon-trigger {
  width: 38px;
  height: 38px;
  justify-content: center;
  border-radius: 10px;
}

.pill-trigger,
.context-pill {
  height: 38px;
  padding: 0 13px;
  font-size: 13px;
  background: color-mix(in srgb, var(--color-surface-container) 74%, transparent);

  span { color: var(--color-text-secondary); font-size: 12px; }
}

.active {
  border-color: var(--vscode-focusBorder);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--vscode-focusBorder) 50%, transparent);
}

.controls-left,
.controls-right {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.model-trigger { max-width: 260px; overflow: hidden; }

.floating-panel {
  position: absolute;
  z-index: 30;
  background: #0c0c0c;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 14px;
  box-shadow: 0 22px 60px rgba(0, 0, 0, 0.58);
  color: var(--color-text-primary);
  padding: 12px;
}

.add-panel { left: 18px; bottom: 58px; width: 240px; }
.permission-panel { left: 58px; bottom: 58px; width: 320px; padding: 10px 0; }
.model-panel { right: 174px; bottom: 58px; width: 360px; max-height: 500px; overflow-y: auto; }
.context-panel { right: 126px; bottom: 58px; width: 292px; }
.slash-panel,
.at-panel {
  left: 0;
  right: 0;
  bottom: calc(100% + 10px);
  max-height: min(520px, 58vh);
  padding: 8px;
}

.panel-title,
.group-title {
  padding: 6px 12px;
  font-size: 12px;
  color: var(--color-text-secondary);
  font-weight: 700;
}

.group-title { display: flex; justify-content: space-between; }

.menu-row,
.permission-row,
.model-row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 13px;
  border: none;
  background: transparent;
  color: var(--color-text-primary);
  text-align: left;
  cursor: pointer;
}

.menu-row { padding: 12px; border-radius: 10px; }
.permission-row,
.model-row {
  padding: 12px 18px;
  small { display: block; margin-top: 3px; color: var(--color-text-secondary); }
  &.selected,
  &:hover { background: rgba(255, 255, 255, 0.09); }
}

.check-icon { margin-left: auto; color: #ffb29c; }
.radio-dot { width: 16px; height: 16px; border: 2px solid var(--color-text-secondary); border-radius: 50%; flex-shrink: 0; }
.model-row.selected .radio-dot { border-color: #ffb29c; box-shadow: inset 0 0 0 4px #0c0c0c; background: #ffb29c; }

.effort-box {
  position: sticky;
  bottom: -12px;
  margin: 12px -12px -12px;
  padding: 8px 12px 12px;
  background: #0c0c0c;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

.effort-options {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;

  button {
    border: none;
    border-radius: 12px;
    padding: 9px 0;
    background: rgba(255, 255, 255, 0.12);
    color: var(--color-text-primary);
    cursor: pointer;

    &.selected { background: #ffb29c; color: #1f110c; font-weight: 700; }
  }
}

.context-head { display: flex; justify-content: space-between; font-size: 13px; > strong { font-size: 22px; } }
.context-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin: 18px 0 14px; color: var(--color-text-secondary); font-size: 12px; strong { color: var(--color-text-primary); } }
.meter-row { display: flex; justify-content: space-between; color: var(--color-text-secondary); font-size: 12px; margin-top: 10px; }
.meter { height: 4px; margin-top: 5px; background: rgba(255, 255, 255, 0.1); border-radius: 999px; overflow: hidden; i { display: block; height: 100%; background: #d94a2e; } &.blue i { background: #2386c8; } }

svg { width: 18px; height: 18px; flex-shrink: 0; }

@media (max-width: 760px) {
  .controls-right { gap: 6px; }
  .model-trigger { max-width: 150px; }
  .model-panel,
  .context-panel { right: 0; }
}
</style>
