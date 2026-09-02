<script setup lang="ts">
import { computed, h, nextTick, onMounted, onUnmounted, ref, render, watch } from 'vue'
import {
  ArrowRight,
  AtSign,
  Bot,
  Check,
  ChevronDown,
  File as FileIcon,
  Box,
  Gauge,
  Hammer,
  Paperclip,
  Plus,
  ShieldCheck,
  Slash,
  Sparkles,
  Square,
  Zap,
} from 'lucide-vue-next'
import { useChatStore } from '@/stores/chat'
import { useProviderStore } from '@/stores/provider'
import Button from '@/components/common/Button.vue'
import SlashCommandMenu from './SlashCommandMenu.vue'
import FileSearchMenu from './FileSearchMenu.vue'
import SkillListMenu from './SkillListMenu.vue'
import AttachmentGallery from './AttachmentGallery.vue'
import ComposerDropOverlay from './ComposerDropOverlay.vue'
import ImageGalleryModal from '@/components/common/ImageGalleryModal.vue'
import { useVSCode } from '@/composables/useVSCode'
import type { EffortLevel, PermissionMode } from '@/stores/provider'
import type {
  ComposerAttachment,
  FileSearchEntry,
  SkillEntry,
  SlashCommand,
  WorkspaceReference,
  MessageSkill,
  InlineMessageSegment,
} from '@/types'
import {
  filterSkills,
  filterSlashCommands,
  findAtTrigger,
  findSkillListTrigger,
  findSlashTrigger,
  formatSkillPrompt,
  mergeSlashCommands,
  normalizeSlashCommand,
} from '@/lib/composerUtils'
import {
  composerAttachmentToPayload,
  createId,
  fileToComposerAttachment,
  workspaceReferenceToPayload,
} from '@/lib/composerAttachments'
import { galleryImagesFromComposer } from '@/utils/imageAttachments'

const chatStore = useChatStore()
const providerStore = useProviderStore()
const vscode = useVSCode()
const input = ref('')
const textarea = ref<HTMLElement>()
const chatInputEl = ref<HTMLElement>()
const openPanel = ref<'add' | 'permission' | 'model' | 'context' | 'slash' | 'at' | 'skill' | null>(
  null
)
const attachments = ref<ComposerAttachment[]>([])
const workspaceReferences = ref<WorkspaceReference[]>([])
const selectedSkills = ref<MessageSkill[]>([])
const attachmentRegistry = new Map<string, ComposerAttachment>()
const referenceRegistry = new Map<string, WorkspaceReference>()
const skillRegistry = new Map<string, MessageSkill>()
const slashCommands = ref<SlashCommand[]>(mergeSlashCommands([]))
const slashFilter = ref('')
const slashSelectedIndex = ref(0)
const slashTriggerStart = ref<number | null>(null)
const atFilter = ref('')
const atSelectedIndex = ref(0)
const atTriggerStart = ref<number | null>(null)
const fileEntries = ref<FileSearchEntry[]>([])
const skills = ref<SkillEntry[]>([])
const skillFilter = ref('')
const skillSelectedIndex = ref(0)
const skillTriggerStart = ref<number | null>(null)
const isDragActive = ref(false)
const imageModalOpen = ref(false)
const imageModalIndex = ref(0)

const permissionOptions = [
  {
    value: 'default',
    label: '询问权限',
    desc: 'CLI 请求时确认文件编辑和高风险命令',
    icon: ShieldCheck,
  },
  { value: 'acceptEdits', label: '自动接受编辑', desc: 'Evancod 无需询问即可写入磁盘', icon: Zap },
  { value: 'plan', label: '计划模式', desc: '仅架构和推理，不操作文件', icon: Bot },
  {
    value: 'bypassPermissions',
    label: '跳过权限',
    desc: '对 Shell 和文件系统的完整工具访问',
    icon: Hammer,
  },
] as const

const usage = computed(() => chatStore.tokenUsage)
const contextWindow = computed(
  () =>
    usage.value?.contextWindow ||
    providerStore.activeProvider?.modelContextWindows?.[providerStore.currentModel] ||
    providerStore.activeProvider?.autoCompactWindow ||
    200000
)
const effectiveContextWindow = computed(
  () =>
    usage.value?.effectiveContextWindow ||
    Math.max(contextWindow.value - Math.min(20000, Math.floor(contextWindow.value * 0.1)), 0)
)
const inputTokens = computed(() => usage.value?.inputTokens || 0)
const cacheReadTokens = computed(() => usage.value?.cacheReadTokens || 0)
const cacheWriteTokens = computed(() => usage.value?.cacheWriteTokens || 0)
const outputTokens = computed(() => usage.value?.outputTokens || 0)
const currentPromptTokens = computed(() => usage.value?.lastPromptTokens || 0)
const currentCacheReadTokens = computed(() => usage.value?.lastCacheReadTokens || 0)
const currentCacheWriteTokens = computed(() => usage.value?.lastCacheWriteTokens || 0)
const currentOutputTokens = computed(() => usage.value?.lastOutputTokens || 0)
const usedTokens = computed(
  () => usage.value?.estimatedCurrentTokens || usage.value?.lastPromptTokens || inputTokens.value
)
const remainingTokens = computed(() =>
  Math.max(effectiveContextWindow.value - usedTokens.value, 0)
)
const contextPercent = computed(
  () =>
    usage.value?.percentUsed ??
    (effectiveContextWindow.value
      ? Math.min(Math.round((usedTokens.value / effectiveContextWindow.value) * 100), 100)
      : 0)
)
const currentPermission = computed(
  () =>
    permissionOptions.find(option => option.value === providerStore.permissionMode) ||
    permissionOptions[0]
)
const selectedModelOption = computed(() =>
  providerStore.modelOptions.find(option => option.model === providerStore.currentModel)
)
const providerGroups = computed(() =>
  providerStore.providers.map(provider => ({
    provider,
    models: [
      { kind: 'main', model: provider.models.main },
      { kind: 'sonnet', model: provider.models.sonnet },
      { kind: 'opus', model: provider.models.opus },
      { kind: 'haiku', model: provider.models.haiku },
    ].filter(
      (item, index, items) =>
        item.model && items.findIndex(candidate => candidate.model === item.model) === index
    ),
  }))
)
const modelLabel = computed(() => selectedModelOption.value?.model || providerStore.currentModel)
const providerLabel = computed(() => providerStore.activeProvider?.name || '未配置')
const isRunning = computed(() =>
  ['thinking', 'running', 'waiting_permission', 'waiting_interaction'].includes(chatStore.chatState)
)
const canSend = computed(
  () =>
    isRunning.value ||
    Boolean(
      input.value.trim() ||
      attachments.value.length ||
      workspaceReferences.value.length ||
      selectedSkills.value.length
    )
)
const filteredSlashCommands = computed(() =>
  filterSlashCommands(slashCommands.value, slashFilter.value)
)
const filteredSkills = computed(() => filterSkills(skills.value, skillFilter.value))
const galleryImages = computed(() => galleryImagesFromComposer(attachments.value))

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

function editorText() {
  if (!textarea.value) return ''
  const clone = textarea.value.cloneNode(true) as HTMLElement
  clone.querySelectorAll('[data-token-kind]').forEach(token => token.remove())
  return (clone.innerText || '').replace(/\u00a0/g, ' ')
}

function syncEditorInput() {
  syncTokensFromEditor()
  input.value = editorText()
  handleInput()
}

function syncTokensFromEditor() {
  const editor = textarea.value
  if (!editor) return
  const fileIds = new Set(
    Array.from(editor.querySelectorAll<HTMLElement>('[data-token-kind="file"]')).map(
      token => token.dataset.tokenId
    )
  )
  const skillNames = new Set(
    Array.from(editor.querySelectorAll<HTMLElement>('[data-token-kind="skill"]')).map(
      token => token.dataset.tokenId
    )
  )
  const images = attachments.value.filter(item => item.type === 'image')
  attachments.value = [
    ...images,
    ...Array.from(fileIds)
      .map(id => (id ? attachmentRegistry.get(id) : undefined))
      .filter((item): item is ComposerAttachment => !!item),
  ]
  workspaceReferences.value = Array.from(fileIds)
    .map(id => (id ? referenceRegistry.get(id) : undefined))
    .filter((item): item is WorkspaceReference => !!item)
  selectedSkills.value = Array.from(skillNames)
    .map(name => (name ? skillRegistry.get(name) : undefined))
    .filter((item): item is MessageSkill => !!item)
}

function insertToken(kind: 'file' | 'skill', label: string, id: string, replaceTrigger = '') {
  const editor = textarea.value
  if (!editor) return
  const selection = window.getSelection()
  editor.focus()
  const currentRange = selection?.rangeCount ? selection.getRangeAt(0) : null
  const range = currentRange && editor.contains(currentRange.commonAncestorContainer)
    ? currentRange
    : document.createRange()
  if (!currentRange || !editor.contains(currentRange.commonAncestorContainer)) {
    range.selectNodeContents(editor)
    range.collapse(false)
  }
  if (
    replaceTrigger &&
    range.collapsed &&
    range.startContainer.nodeType === Node.TEXT_NODE &&
    range.startOffset >= replaceTrigger.length
  ) {
    const text = range.startContainer.textContent || ''
    const start = range.startOffset - replaceTrigger.length
    if (text.slice(start, range.startOffset) === replaceTrigger) {
      range.setStart(range.startContainer, start)
      range.deleteContents()
    }
  }
  const token = document.createElement('span')
  token.className = `inline-token inline-token--${kind}`
  token.dataset.tokenKind = kind
  token.dataset.tokenId = id
  if (kind === 'skill')
    token.dataset.skillDescription =
      selectedSkills.value.find(skill => skill.name === label)?.description || ''
  token.contentEditable = 'false'
  const iconHost = document.createElement('span')
  iconHost.className = 'inline-token__icon'
  render(h(kind === 'file' ? FileIcon : Box, { size: 16, strokeWidth: 2 }), iconHost)
  token.append(iconHost)
  const labelNode = document.createElement('span')
  labelNode.textContent = label
  token.append(labelNode)
  range.deleteContents()
  range.insertNode(token)
  range.setStartAfter(token)
  range.collapse(true)
  selection?.removeAllRanges()
  selection?.addRange(range)
  syncEditorInput()
}

function removeTriggerText(trigger: string) {
  const editor = textarea.value
  if (!editor || !trigger) return
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  let node: Node | null
  while ((node = walker.nextNode())) nodes.push(node as Text)

  // 触发文本可能因 contenteditable 的选区操作被拆到多个文本节点，
  // 先按可见文本定位最后一次出现位置，再跨节点删除对应字符。
  const fullText = nodes.map(textNode => textNode.data).join('')
  const start = fullText.lastIndexOf(trigger)
  if (start < 0) return

  let offset = 0
  let remainingLength = trigger.length
  for (const textNode of nodes) {
    const nodeStart = offset
    const nodeEnd = offset + textNode.data.length
    offset = nodeEnd
    if (nodeEnd <= start || nodeStart >= start + trigger.length) continue

    const deleteStart = Math.max(start, nodeStart) - nodeStart
    const deleteEnd = Math.min(start + trigger.length, nodeEnd) - nodeStart
    textNode.deleteData(deleteStart, deleteEnd - deleteStart)
    remainingLength -= deleteEnd - deleteStart
    if (remainingLength <= 0) break
  }
}

function removeToken(token: HTMLElement) {
  const kind = token.dataset.tokenKind
  const id = token.dataset.tokenId
  token.remove()

  if (kind === 'file') {
    attachments.value = attachments.value.filter(item => item.id !== id)
    workspaceReferences.value = workspaceReferences.value.filter(item => item.id !== id)
    attachmentRegistry.delete(id || '')
    referenceRegistry.delete(id || '')
  } else if (kind === 'skill') {
    selectedSkills.value = selectedSkills.value.filter(item => item.name !== id)
    skillRegistry.delete(id || '')
  }

  syncEditorInput()
}

function adjacentSibling(node: Node, direction: 'backward' | 'forward'): Node | null {
  let current: Node | null = node
  while (current && current.parentNode) {
    const parent: Node = current.parentNode
    const index = Array.prototype.indexOf.call(parent.childNodes, current) as number
    const sibling = parent.childNodes[direction === 'backward' ? index - 1 : index + 1]
    if (sibling) return sibling
    current = parent
  }
  return null
}

function tokenAdjacentToCaret(direction: 'backward' | 'forward') {
  const editor = textarea.value
  const selection = window.getSelection()
  if (!editor || !selection?.rangeCount) return null
  const range = selection.getRangeAt(0)
  if (!editor.contains(range.commonAncestorContainer)) return null
  if (!range.collapsed) {
    return (
      Array.from(editor.querySelectorAll<HTMLElement>('[data-token-kind]')).find(token =>
        range.intersectsNode(token)
      ) || null
    )
  }

  if (range.startContainer.nodeType === Node.TEXT_NODE) {
    const textLength = range.startContainer.textContent?.length || 0
    if (direction === 'backward' && range.startOffset > 0) return null
    if (direction === 'forward' && range.startOffset < textLength) return null
  } else {
    const childCount = range.startContainer.childNodes.length
    if (direction === 'backward' && range.startOffset > 0) {
      const previous = range.startContainer.childNodes[range.startOffset - 1] as HTMLElement
      if (previous?.dataset?.tokenKind) return previous
      return null
    }
    if (direction === 'forward' && range.startOffset < childCount) {
      const next = range.startContainer.childNodes[range.startOffset] as HTMLElement
      if (next?.dataset?.tokenKind) return next
      return null
    }
  }

  const sibling = adjacentSibling(range.startContainer, direction)
  return sibling instanceof HTMLElement && sibling.dataset.tokenKind ? sibling : null
}

function insertTextAtCaret(text: string) {
  const editor = textarea.value
  if (!editor) return
  const selection = window.getSelection()
  const range = selection?.rangeCount ? selection.getRangeAt(0) : document.createRange()
  if (!selection?.rangeCount) {
    range.selectNodeContents(editor)
    range.collapse(false)
  }
  range.deleteContents()
  const node = document.createTextNode(text)
  range.insertNode(node)
  range.setStartAfter(node)
  range.collapse(true)
  selection?.removeAllRanges()
  selection?.addRange(range)
}

function serializeEditor() {
  const editor = textarea.value
  if (!editor) {
    const segments: InlineMessageSegment[] = [{ type: 'text', text: input.value }]
    return { content: input.value, skills: selectedSkills.value, segments }
  }
  const skillsInOrder: MessageSkill[] = []
  const segments: InlineMessageSegment[] = []
  const walk = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent || ''
      if (text) segments.push({ type: 'text', text })
      return text
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return ''
    const element = node as HTMLElement
    if (element.dataset.tokenKind === 'skill') {
      const skill = {
        name: element.textContent || '',
        description: element.dataset.skillDescription || undefined,
      }
      skillsInOrder.push(skill)
      segments.push({ type: 'skill', name: skill.name, description: skill.description })
      return formatSkillPrompt(skill)
    }
    if (element.dataset.tokenKind === 'file') {
      const id = element.dataset.tokenId
      const file =
        attachments.value.find(item => item.id === id) ||
        workspaceReferences.value.find(item => item.id === id)
      if (file) segments.push({ type: 'file', name: file.name, path: file.path })
      return ''
    }
    if (element.tagName === 'BR') return '\n'
    return Array.from(node.childNodes).map(walk).join('')
  }
  return {
    content: Array.from(editor.childNodes).map(walk).join('').trim(),
    skills: skillsInOrder,
    segments,
  }
}

function handleInput() {
  adjustHeight()
  const cursor = input.value.length

  // /skill-list 需优先于普通斜杠命令检测，否则会被当作普通斜杠命令
  const skillList = findSkillListTrigger(input.value, cursor)
  if (skillList) {
    skillFilter.value = skillList.filter
    skillTriggerStart.value = skillList.start
    skillSelectedIndex.value = 0
    openPanel.value = 'skill'
    vscode.postMessage({ type: 'skills.request' })
    return
  }

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

  if (openPanel.value === 'slash' || openPanel.value === 'at' || openPanel.value === 'skill') {
    openPanel.value = null
  }
}

function handleSend() {
  if (isRunning.value) {
    chatStore.stopGeneration()
    return
  }

  const serialized = serializeEditor()
  const text = serialized.content.trim()
  if (
    !text &&
    !attachments.value.length &&
    !workspaceReferences.value.length &&
    !selectedSkills.value.length
  )
    return

  const content = text
  const files = [
    ...attachments.value.map(composerAttachmentToPayload),
    ...workspaceReferences.value.map(workspaceReferenceToPayload),
  ]
  const displayAttachments = [
    ...attachments.value.map(attachment => ({
      path: attachment.path || attachment.name,
      name: attachment.name,
      kind: attachment.type === 'image' ? ('image' as const) : ('binary' as const),
      mime: attachment.mimeType,
      size: attachment.size || 0,
      base64: attachment.type === 'image' ? attachment.data?.split(',')[1] : undefined,
    })),
    ...workspaceReferences.value.map(reference => ({
      path: reference.path,
      name: reference.name,
      kind: 'text' as const,
      size: 0,
    })),
  ]

  chatStore.sendMessage(content, files, serialized.skills, displayAttachments, serialized.segments)
  input.value = ''
  if (textarea.value) textarea.value.innerHTML = ''
  attachments.value = []
  workspaceReferences.value = []
  selectedSkills.value = []
  attachmentRegistry.clear()
  referenceRegistry.clear()
  skillRegistry.clear()
  openPanel.value = null
  nextTick(adjustHeight)
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Backspace' || event.key === 'Delete') {
    const direction = event.key === 'Backspace' ? 'backward' : 'forward'
    const token = tokenAdjacentToCaret(direction)
    if (token) {
      event.preventDefault()
      removeToken(token)
      return
    }
  }

  if (openPanel.value === 'slash') {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const direction = event.key === 'ArrowDown' ? 1 : -1
      slashSelectedIndex.value =
        (slashSelectedIndex.value + direction + filteredSlashCommands.value.length) %
        Math.max(filteredSlashCommands.value.length, 1)
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
      atSelectedIndex.value =
        (atSelectedIndex.value + direction + fileEntries.value.length) %
        Math.max(fileEntries.value.length, 1)
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

  if (openPanel.value === 'skill') {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const direction = event.key === 'ArrowDown' ? 1 : -1
      skillSelectedIndex.value =
        (skillSelectedIndex.value + direction + filteredSkills.value.length) %
        Math.max(filteredSkills.value.length, 1)
      return
    }
    if (event.key === 'Tab' || event.key === 'Enter') {
      event.preventDefault()
      const selected = filteredSkills.value[skillSelectedIndex.value]
      if (selected) applySkill(selected)
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      openPanel.value = null
      return
    }
  }

  if (
    event.key === 'Enter' &&
    !event.shiftKey &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.altKey
  ) {
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

  // /skill-list 不作为文本插入，改为打开技能选择弹框
  if (normalized.name === 'skill-list') {
    if (slashTriggerStart.value != null) {
      const trigger = input.value.slice(slashTriggerStart.value)
      const before = input.value.slice(0, slashTriggerStart.value)
      const after = ''
      input.value = `${before}${after}`
      removeTriggerText(trigger)
      nextTick(() => {
        textarea.value?.focus()
        adjustHeight()
      })
    }
    skillTriggerStart.value = null
    skillFilter.value = ''
    skillSelectedIndex.value = 0
    openPanel.value = 'skill'
    vscode.postMessage({ type: 'skills.request' })
    return
  }

  if (slashTriggerStart.value == null) return
  const cursor = input.value.length
  const trigger =
    slashTriggerStart.value == null ? '' : input.value.slice(slashTriggerStart.value, cursor)
  const before = input.value.slice(0, slashTriggerStart.value)
  const after = input.value.slice(cursor)
  const inserted = `/${normalized.name} `
  input.value = `${before}${inserted}${after}`
  removeTriggerText(trigger)
  insertTextAtCaret(inserted)
  openPanel.value = null
  nextTick(() => {
    textarea.value?.focus()
    textarea.value?.focus()
    adjustHeight()
  })
}

function applyFileReference(entry: FileSearchEntry) {
  if (atTriggerStart.value == null) return
  const cursor = input.value.length
  const trigger = input.value.slice(atTriggerStart.value, cursor)
  const before = input.value.slice(0, atTriggerStart.value)
  const after = input.value.slice(cursor)
  input.value = `${before}${after}`
  removeTriggerText(trigger)
  if (!workspaceReferences.value.some(reference => reference.path === entry.path)) {
    const id = createId()
    workspaceReferences.value.push({
      id,
      type: entry.type,
      name: entry.name,
      path: entry.path,
      relativePath: entry.relativePath,
    })
    referenceRegistry.set(id, workspaceReferences.value[workspaceReferences.value.length - 1])
    insertToken('file', entry.name, id)
  }
  // 插入 token 可能重新定位选区，再做一次 DOM 清理，避免触发路径残留。
  removeTriggerText(trigger)
  syncEditorInput()
  openPanel.value = null
  nextTick(() => {
    textarea.value?.focus()
    textarea.value?.focus()
    adjustHeight()
  })
}

function applySkill(skill: SkillEntry) {
  const cursor = input.value.length
  // skillTriggerStart 为空表示通过 + 菜单等入口打开，直接插入到光标处
  const anchor = skillTriggerStart.value ?? cursor
  const before = input.value.slice(0, anchor)
  const after = input.value.slice(cursor)
  const trigger = input.value.slice(anchor, cursor)
  input.value = `${before}${after}`
  removeTriggerText(trigger)
  if (!selectedSkills.value.some(item => item.name === skill.name)) {
    selectedSkills.value.push({
      name: skill.name,
      description: skill.description,
      trigger: skill.trigger,
    })
    skillRegistry.set(skill.name, selectedSkills.value[selectedSkills.value.length - 1])
    insertToken('skill', skill.name, skill.name)
  }
  removeTriggerText(trigger)
  syncEditorInput()
  openPanel.value = null
  skillTriggerStart.value = null
  nextTick(() => {
    textarea.value?.focus()
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

function openFileReferencePanel() {
  openPanel.value = 'at'
  atFilter.value = ''
  atSelectedIndex.value = 0
  vscode.postMessage({ type: 'filesystem.browse', data: {} })
}

function openSkillListPanel() {
  openPanel.value = 'skill'
  skillFilter.value = ''
  skillSelectedIndex.value = 0
  skillTriggerStart.value = null
  vscode.postMessage({ type: 'skills.request' })
}

async function appendFiles(files: File[]) {
  const converted = await Promise.all(files.map(fileToComposerAttachment))
  converted.forEach(file => {
    attachments.value.push(file)
    if (file.type === 'file') {
      attachmentRegistry.set(file.id, file)
      insertToken('file', file.name, file.id)
    }
  })
}

async function handlePaste(event: ClipboardEvent) {
  const inlineData = event.clipboardData?.getData('application/x-evancod-inline-segments')
  if (inlineData) {
    try {
      const segments = JSON.parse(inlineData) as InlineMessageSegment[]
      event.preventDefault()
      for (const segment of segments) {
        if (segment.type === 'text') insertTextAtCaret(segment.text || '')
        else if (segment.type === 'skill') {
          selectedSkills.value.push({ name: segment.name || '', description: segment.description })
          skillRegistry.set(
            segment.name || '',
            selectedSkills.value[selectedSkills.value.length - 1]
          )
          insertToken('skill', segment.name || '', segment.name || '')
        } else if (segment.type === 'file' && segment.path) {
          const id = createId()
          workspaceReferences.value.push({
            id,
            type: 'file',
            name: segment.name || segment.path,
            path: segment.path,
            relativePath: segment.path,
          })
          referenceRegistry.set(id, workspaceReferences.value[workspaceReferences.value.length - 1])
          insertToken('file', segment.name || segment.path, id)
        }
      }
      syncEditorInput()
      return
    } catch {
      // 回退到普通粘贴
    }
  }

  // contenteditable 默认会粘贴来源编辑器的 HTML/style，导致字体和布局被污染。
  // 普通文本统一以纯文本插入，使内容继承当前输入区样式。
  const files = Array.from(event.clipboardData?.items ?? [])
    .filter(item => item.type.startsWith('image/'))
    .map(item => item.getAsFile())
    .filter((file): file is File => !!file)
  if (files.length) {
    event.preventDefault()
    await appendFiles(files)
    return
  }

  const text = event.clipboardData?.getData('text/plain')
  if (text == null) return
  event.preventDefault()
  insertTextAtCaret(text.replace(/\r\n?/g, '\n'))
  syncEditorInput()
}

function handleDrop(event: DragEvent) {
  event.preventDefault()
  isDragActive.value = false
  const files = Array.from(event.dataTransfer?.files ?? [])
  void appendFiles(files)
}

function handlePreviewImage(attachmentId: string) {
  const index = attachments.value.findIndex(a => a.id === attachmentId)
  if (index === -1) return
  imageModalIndex.value = index
  imageModalOpen.value = true
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
      const attachment = attachments.value[attachments.value.length - 1]
      attachmentRegistry.set(attachment.id, attachment)
      insertToken('file', file.name || file.path, attachment.id)
    }
  }

  if (message.type === 'slash.commands') {
    slashCommands.value = mergeSlashCommands(message.data.commands || [])
  }

  if (message.type === 'skills.list') {
    skills.value = message.data.skills || []
    skillSelectedIndex.value = 0
  }

  if (
    message.type === 'filesystem.search.results' ||
    message.type === 'filesystem.browse.results'
  ) {
    fileEntries.value = message.data.entries || []
    atSelectedIndex.value = 0
  }
}

function handleClickOutside(event: MouseEvent) {
  if (!openPanel.value) return
  const target = event.target as HTMLElement
  // 点击浮层面板内部，或点击触发按钮（交给 togglePanel 处理），都不在此关闭
  if (target.closest('.floating-panel') || target.closest('.chat-input__controls')) {
    return
  }
  openPanel.value = null
}

onMounted(() => {
  window.addEventListener('message', handleMessage)
  document.addEventListener('mousedown', handleClickOutside)
  vscode.postMessage({ type: 'slash.commands.request' })
  vscode.postMessage({ type: 'skills.request' })
})
onUnmounted(() => {
  window.removeEventListener('message', handleMessage)
  document.removeEventListener('mousedown', handleClickOutside)
})
</script>

<template>
  <div class="composer-wrap">
    <div
      ref="chatInputEl"
      class="chat-input"
      :class="{ focused: openPanel }"
      @dragenter.prevent="isDragActive = true"
      @dragover.prevent="isDragActive = true"
      @dragleave.prevent="isDragActive = false"
      @drop="handleDrop"
    >
      <ComposerDropOverlay v-if="isDragActive" />
      <AttachmentGallery
        :attachments="attachments.filter(item => item.type === 'image')"
        :references="[]"
        @remove-attachment="attachments = attachments.filter(item => item.id !== $event)"
        @remove-reference="
          workspaceReferences = workspaceReferences.filter(item => item.id !== $event)
        "
        @preview-image="handlePreviewImage"
      />

      <div
        ref="textarea"
        class="chat-input__textarea"
        contenteditable="true"
        role="textbox"
        aria-multiline="true"
        placeholder="让 Evancod 编辑、调试或解释代码..."
        @input="syncEditorInput"
        @keydown="handleKeydown"
        @paste="handlePaste"
      ></div>

      <div class="chat-input__controls">
        <div class="controls-left">
          <button
            class="icon-trigger add-trigger"
            :class="{ active: openPanel === 'add' }"
            @click="togglePanel('add')"
          >
            <Plus />
          </button>

          <button
            class="pill-trigger permission-trigger"
            :class="{ active: openPanel === 'permission' }"
            @click="togglePanel('permission')"
          >
            <component :is="currentPermission.icon" />
            {{ currentPermission.label }}
            <ChevronDown />
          </button>
        </div>

        <div class="controls-right">
          <button
            class="context-pill"
            :class="{ active: openPanel === 'context' }"
            @click="togglePanel('context')"
          >
            <Gauge /> {{ contextPercent }}%
          </button>

          <button
            class="pill-trigger model-trigger"
            :class="{ active: openPanel === 'model' }"
            :title="`${modelLabel} · ${providerLabel}`"
            @click="togglePanel('model')"
          >
            <span class="model-trigger__model">{{ modelLabel }}</span>
            <span class="model-trigger__provider">{{ providerLabel }}</span>
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
        <button class="menu-row" @click="openFileReferencePanel">
          <AtSign />
          <span>@ 选择工作区文件</span>
        </button>
        <button class="menu-row" @click="openPanel = 'slash'">
          <Slash />
          <span>斜杠命令</span>
        </button>
        <button class="menu-row" @click="openSkillListPanel">
          <Sparkles />
          <span>浏览技能</span>
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
            :class="{
              selected:
                group.provider.id === providerStore.activeProviderId &&
                option.model === providerStore.currentModel,
            }"
            @click="selectModel(group.provider.id, option.model)"
          >
            <span class="radio-dot" />
            <span class="model-row__content">
              <strong :title="option.model">{{ option.model }}</strong>
              <small>{{ option.kind }} 模型 · {{ group.provider.apiFormat }}</small>
            </span>
          </button>
        </div>

        <div class="effort-box">
          <div class="panel-title">推理强度</div>
          <div class="effort-options">
            <button
              :class="{ selected: providerStore.effortLevel === 'low' }"
              @click="selectEffortLevel('low')"
            >
              低
            </button>
            <button
              :class="{ selected: providerStore.effortLevel === 'medium' }"
              @click="selectEffortLevel('medium')"
            >
              中
            </button>
            <button
              :class="{ selected: providerStore.effortLevel === 'high' }"
              @click="selectEffortLevel('high')"
            >
              高
            </button>
            <button
              :class="{ selected: providerStore.effortLevel === 'max' }"
              @click="selectEffortLevel('max')"
            >
              最大
            </button>
          </div>
        </div>
      </div>

      <div v-if="openPanel === 'context'" class="floating-panel context-panel">
        <div class="context-head">
            <span
            >上下文<span v-if="usage?.estimated">（估算）</span><br /><strong>{{ modelLabel }}</strong></span
          >
          <strong>{{ contextPercent }}%</strong>
        </div>
        <div class="context-grid">
          <span
            >已使用<br /><strong>{{ usedTokens.toLocaleString() }}</strong></span
          >
          <span
            >剩余<br /><strong>{{ remainingTokens.toLocaleString() }}</strong></span
          >
          <span
            >窗口<br /><strong>{{ contextWindow.toLocaleString() }}</strong></span
          >
        </div>
        <div class="meter-row">
          <span>当前 Prompt（含缓存）</span><em>{{ currentPromptTokens.toLocaleString() }}</em>
        </div>
        <div class="meter"><i :style="{ width: `${Math.min(Math.round((currentPromptTokens / contextWindow) * 100), 100)}%` }" /></div>
        <div class="meter-row">
          <span>Cache read（已含于 Prompt）</span><em>{{ currentCacheReadTokens.toLocaleString() }}</em>
        </div>
        <div class="meter blue">
          <i :style="{ width: `${Math.min(Math.round((currentCacheReadTokens / contextWindow) * 100), 100)}%` }" />
        </div>
        <div class="meter-row">
          <span>当前 Cache write</span><em>{{ currentCacheWriteTokens.toLocaleString() }}</em>
        </div>
        <div class="meter blue">
          <i :style="{ width: `${Math.min(Math.round((currentCacheWriteTokens / contextWindow) * 100), 100)}%` }" />
        </div>
        <div class="meter-row">
          <span>当前 Output</span><em>{{ currentOutputTokens.toLocaleString() }}</em>
        </div>
        <div class="meter">
          <i :style="{ width: `${Math.min(Math.round((currentOutputTokens / contextWindow) * 100), 100)}%` }" />
        </div>
        <div class="meter-row meter-row--cumulative">
          <span>累计 Input / Cache / Output</span>
          <em>{{ inputTokens.toLocaleString() }} / {{ cacheReadTokens.toLocaleString() }} / {{ outputTokens.toLocaleString() }}</em>
        </div>
        <div v-if="cacheWriteTokens" class="meter-row meter-row--cumulative">
          <span>累计 Cache write</span><em>{{ cacheWriteTokens.toLocaleString() }}</em>
        </div>
      </div>

      <div v-if="openPanel === 'slash'" class="floating-panel slash-panel">
        <SlashCommandMenu
          :commands="filteredSlashCommands"
          :selected-index="slashSelectedIndex"
          @hover="slashSelectedIndex = $event"
          @select="applySlashCommand"
        />
      </div>

      <div v-if="openPanel === 'at'" class="floating-panel at-panel">
        <FileSearchMenu
          :entries="fileEntries"
          :selected-index="atSelectedIndex"
          @hover="atSelectedIndex = $event"
          @select="applyFileReference"
        />
      </div>

      <div v-if="openPanel === 'skill'" class="floating-panel skill-panel">
        <SkillListMenu
          :skills="filteredSkills"
          :selected-index="skillSelectedIndex"
          @hover="skillSelectedIndex = $event"
          @select="applySkill"
        />
      </div>
    </div>

    <ImageGalleryModal
      v-model="imageModalOpen"
      :images="galleryImages"
      :initial-index="imageModalIndex"
    />
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
    display: block;
    min-width: 0;
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
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    word-break: break-word;
    overflow-y: auto;

    &::placeholder {
      color: var(--vscode-input-placeholderForeground, var(--color-text-tertiary));
    }
    &:focus {
      outline: none;
    }

    &:empty::before {
      color: var(--vscode-input-placeholderForeground, var(--color-text-tertiary));
      content: attr(placeholder);
      pointer-events: none;
    }
  }

  :deep(.inline-token--file) {
    color: #f3c777;
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

:deep(.inline-token) {
  display: inline-flex;
  align-items: center;
  padding: 1px 2px;
  color: #67c0ff;
  font-size: 13px;
  line-height: 1.5;
  vertical-align: bottom;
  user-select: all;
}
:deep(.inline-token--file) {
  color: #79c9ff;
}
:deep(.inline-token__icon) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-right: 5px;
  color: #55b7ff;
}
:deep(.inline-token__icon svg) {
  display: block;
}
:deep(.inline-token--skill) {
  color: #69bfff;
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

  span {
    color: var(--color-text-secondary);
    font-size: 12px;
  }
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

.model-trigger {
  min-width: 0;
  max-width: min(42vw, 260px);
  flex: 1 1 auto;
  overflow: hidden;
  white-space: nowrap;

  &__model,
  &__provider {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &__model {
    flex: 1 1 auto;
  }

  &__provider {
    flex: 0 1 auto;
    max-width: 96px;
  }
}

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

.add-panel {
  left: 18px;
  bottom: 58px;
  width: 240px;
}
.permission-panel {
  left: 58px;
  bottom: 58px;
  width: 320px;
  padding: 10px 0;
}
.model-panel {
  right: 174px;
  bottom: 58px;
  width: min(360px, calc(100vw - 40px));
  max-height: 500px;
  overflow-y: auto;
}
.context-panel {
  right: 126px;
  bottom: 58px;
  width: 292px;
}
.slash-panel,
.at-panel,
.skill-panel {
  left: 0;
  right: 0;
  bottom: calc(100% + 10px);
  max-height: min(520px, 58vh);
  padding: 8px;
  overflow: hidden;
}

.panel-title,
.group-title {
  padding: 6px 12px;
  font-size: 12px;
  color: var(--color-text-secondary);
  font-weight: 700;
}

.group-title {
  display: flex;
  justify-content: space-between;
}

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

.menu-row {
  padding: 12px;
  border-radius: 10px;
}
.permission-row,
.model-row {
  padding: 12px 18px;
  small {
    display: block;
    margin-top: 3px;
    color: var(--color-text-secondary);
  }
  &.selected,
  &:hover {
    background: rgba(255, 255, 255, 0.09);
  }
}

.check-icon {
  margin-left: auto;
  color: #ffb29c;
}
.radio-dot {
  width: 16px;
  height: 16px;
  border: 2px solid var(--color-text-secondary);
  border-radius: 50%;
  flex-shrink: 0;
}
.model-row.selected .radio-dot {
  border-color: #ffb29c;
  box-shadow: inset 0 0 0 4px #0c0c0c;
  background: #ffb29c;
}

.model-row__content {
  min-width: 0;

  strong,
  small {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

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

    &.selected {
      background: #ffb29c;
      color: #1f110c;
      font-weight: 700;
    }
  }
}

.context-head {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  > strong {
    font-size: 22px;
  }
}
.context-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
  margin: 18px 0 14px;
  color: var(--color-text-secondary);
  font-size: 12px;
  strong {
    color: var(--color-text-primary);
  }
}
.meter-row {
  display: flex;
  justify-content: space-between;
  color: var(--color-text-secondary);
  font-size: 12px;
  margin-top: 10px;
}
.meter {
  height: 4px;
  margin-top: 5px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 999px;
  overflow: hidden;
  i {
    display: block;
    height: 100%;
    background: #d94a2e;
  }
  &.blue i {
    background: #2386c8;
  }
}

svg {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
}

@media (max-width: 760px) {
  .controls-right {
    gap: 6px;
  }
  .model-trigger {
    max-width: min(150px, 36vw);
  }
  .model-panel,
  .context-panel {
    right: 0;
  }
}

@media (max-width: 520px) {
  .model-trigger__provider {
    display: none;
  }
}
</style>
