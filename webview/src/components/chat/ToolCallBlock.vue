<script setup lang="ts">
import { computed, ref } from 'vue'
import DiffViewer from '@/components/diff/DiffViewer.vue'
import TerminalChrome from '@/components/terminal/TerminalChrome.vue'
import ImageGalleryModal from '@/components/common/ImageGalleryModal.vue'
import { base64ToDataUrl } from '@/utils/imageAttachments'
import { summarizeError } from '@/utils/errorSummary'
import type { BashRuntimeState, AgentTaskNotification } from '@/types'

const props = defineProps<{
  toolName: string
  toolUseId: string
  input: unknown
  isPending?: boolean
  partialInput?: string
  parentToolUseId?: string
  bash?: BashRuntimeState
  notification?: AgentTaskNotification
  result?: unknown
  resultError?: boolean
}>()

const emit = defineEmits<{
  cancelBash: [toolUseId: string, taskId?: string]
}>()

const expanded = ref(false)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function textValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function truncate(value: string, length = 80) {
  return value.length > length ? `${value.slice(0, length)}…` : value
}

const inputRecord = computed(() => (isRecord(props.input) ? props.input : null))
const inputText = computed(() => props.partialInput || JSON.stringify(props.input, null, 2))
const filePath = computed(() => textValue(inputRecord.value?.file_path || inputRecord.value?.path))
const command = computed(() => textValue(inputRecord.value?.command))
const description = computed(() => textValue(inputRecord.value?.description))
const oldString = computed(() => textValue(inputRecord.value?.old_string))
const newString = computed(() => textValue(inputRecord.value?.new_string))
const content = computed(() => textValue(inputRecord.value?.content))
const mcpAction = computed(() => textValue(inputRecord.value?.action))
const mcpServer = computed(() => textValue(inputRecord.value?.server))
const mcpTool = computed(() => textValue(inputRecord.value?.tool))
const mcpUri = computed(() => textValue(inputRecord.value?.uri))
const skillName = computed(() => textValue(inputRecord.value?.skill))
const skillArgs = computed(() => textValue(inputRecord.value?.args))
const imagePrompt = computed(() => textValue(inputRecord.value?.prompt))
const bashStatus = computed(() => props.bash?.status || (props.isPending ? 'running' : 'completed'))
const notificationStatus = computed(() => props.notification?.status)
const notificationText = computed(() => props.notification?.summary || props.notification?.result || '')
const status = computed(() => {
  if (props.isPending) return 'pending'
  if (props.resultError) return 'error'
  if (notificationStatus.value === 'failed' || bashStatus.value === 'error' || bashStatus.value === 'timeout') return 'error'
  if (notificationStatus.value === 'stopped' || bashStatus.value === 'cancelled') return 'cancelled'
  return 'success'
})

// 所有 task_* 工具（task_create/task_update/task_list/task_get）统一用 Task 图标，
// 但标题按动作区分，方便识别是创建/更新/删除/查询
const isTaskTool = computed(() => props.toolName.startsWith('task_'))

const title = computed(() => {
  if (isTaskTool.value) {
    // task_update 且 status=deleted 视为删除动作
    if (props.toolName === 'task_update' && textValue(inputRecord.value?.status) === 'deleted') {
      return 'Task 删除'
    }
    const taskLabels: Record<string, string> = {
      task_create: 'Task 创建',
      task_update: 'Task 更新',
      task_list: 'Task 列表',
      task_get: 'Task 详情',
    }
    return taskLabels[props.toolName] || 'Task'
  }

  const labels: Record<string, string> = {
    read_file: 'Read',
    edit_file: 'Edit',
    write_file: 'Write',
    delete_file: 'Delete',
    copy_file: 'Copy',
    move_file: 'Move',
    bash: 'Bash',
    glob: 'Glob',
    grep: 'Grep',
    find: 'Find',
    list_directory: 'List',
    agent: 'Agent',
    enter_plan_mode: 'Plan',
    exit_plan_mode: 'Plan',
    ask_user_question: 'Ask',
    mcp: 'MCP',
    skill: 'Skill',
    image_gen: 'Image',
    web_fetch: 'Fetch',
    web_search: 'Search',
    git_status: 'Git Status',
    git_diff: 'Git Diff',
    git_log: 'Git Log',
    git_branch: 'Git Branch',
    lsp: 'LSP',
    notebook_edit: 'Notebook',
    analyze_dependencies: 'Dependencies',
    analyze_ast: 'AST',
  }

  return labels[props.toolName] || props.toolName
})

const iconType = computed(() => {
  if (isTaskTool.value) return 'task'
  if (props.toolName === 'read_file') return 'read'
  if (props.toolName === 'write_file') return 'write'
  if (props.toolName === 'edit_file') return 'edit'
  if (props.toolName === 'delete_file') return 'delete'
  if (props.toolName === 'copy_file') return 'copy'
  if (props.toolName === 'move_file') return 'move'
  if (props.toolName === 'bash') return 'bash'
  if (props.toolName === 'grep') return 'grep'
  if (props.toolName === 'glob') return 'glob'
  if (props.toolName === 'find') return 'find'
  if (props.toolName === 'list_directory') return 'list_directory'
  if (props.toolName === 'agent') return 'agent'
  if (props.toolName === 'skill') return 'skill'
  if (props.toolName === 'mcp') return 'mcp'
  if (props.toolName === 'image_gen') return 'image'
  if (props.toolName === 'ask_user_question') return 'ask'
  if (props.toolName === 'enter_plan_mode') return 'plan'
  if (props.toolName === 'exit_plan_mode') return 'plan'
  if (props.toolName === 'web_fetch') return 'web'
  if (props.toolName === 'web_search') return 'search'
  if (props.toolName === 'git_status') return 'git'
  if (props.toolName === 'git_diff') return 'git'
  if (props.toolName === 'git_log') return 'git'
  if (props.toolName === 'git_branch') return 'git'
  if (props.toolName === 'lsp') return 'lsp'
  if (props.toolName === 'notebook_edit') return 'notebook'
  if (props.toolName === 'analyze_dependencies') return 'analyze'
  if (props.toolName === 'analyze_ast') return 'analyze'
  return 'default'
})

const summary = computed(() => {
  if (description.value) return description.value
  if (filePath.value) return filePath.value.split('/').pop() || filePath.value
  if (command.value) return truncate(command.value)
  if (mcpTool.value) return mcpTool.value
  if (mcpAction.value) return mcpAction.value
  if (skillName.value) return skillName.value
  if (imagePrompt.value) return truncate(imagePrompt.value)
  if (notificationText.value) return truncate(notificationText.value)
  return truncate(inputText.value.replace(/\s+/g, ' '))
})

const resultSummary = computed(() => {
  if (status.value === 'pending') return ''
  if (status.value === 'error') return 'Failed'
  if (status.value === 'cancelled') return 'Cancelled'
  if (notificationStatus.value === 'completed') return 'Completed'
  if (bashStatus.value === 'completed') return 'Completed'
  return 'Submitted'
})

const expandable = computed(() => true)

// 结果预览上限：超过则截断，避免把整段结果/日志全量塞进 DOM 做布局
const RESULT_MAX_CHARS = 4000

const resultFullText = computed(() =>
  typeof props.result === 'string' ? props.result : JSON.stringify(props.result, null, 2)
)
const resultExpanded = ref(false)
const resultTruncated = computed(() => resultFullText.value.length > RESULT_MAX_CHARS)
const resultDisplayText = computed(() =>
  !resultTruncated.value || resultExpanded.value
    ? resultFullText.value
    : resultFullText.value.slice(0, RESULT_MAX_CHARS)
)

// 错误结果：提炼一句话主旨，原始文本默认折叠
const resultErrorSummary = computed(() =>
  props.resultError ? summarizeError(props.result) : undefined
)
// 有主旨时，原始文本默认折叠（点“查看详情”才展开）；无主旨则直接展示（截断的）原文
const rawResultCollapsed = ref(true)

const hasResult = computed(() => {
  return props.result !== undefined && (['read_file', 'grep', 'glob'].includes(props.toolName) || isTaskTool.value)
})

/** 解析 image_gen 结果中的图片预览（base64） */
interface GeneratedImage {
  src: string
  name: string
}

const generatedImages = computed<GeneratedImage[]>(() => {
  if (props.toolName !== 'image_gen' || props.result === undefined) return []

  let parsed: any = props.result
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed)
    } catch {
      return []
    }
  }

  const previews = parsed?.metadata?._webviewOnly?.previews
  if (!Array.isArray(previews)) return []

  const images: GeneratedImage[] = []
  for (const preview of previews) {
    if (!preview?.base64) continue
    images.push({
      src: base64ToDataUrl(preview.base64, preview.mime),
      name: preview.name || preview.path || 'image'
    })
  }
  return images
})

const modalOpen = ref(false)
const activeImageIndex = ref(0)

function openImageAt(index: number) {
  activeImageIndex.value = index
  modalOpen.value = true
}

</script>

<template>
  <div class="tool-call" :class="[`tool-call--${status}`]">
    <button class="tool-call__header" type="button" @click="expanded = !expanded">
      <span class="tool-call__icon" :class="{ 'tool-call__icon--active': status === 'pending' }">
        <!-- Read icon -->
        <svg v-if="iconType === 'read'" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M3 2h10v12H3V2z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M5 5h6M5 8h6M5 11h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
        <!-- Write icon -->
        <svg v-else-if="iconType === 'write'" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M3 2h10v12H3V2z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M6 10l1.5-1.5L11 5l-1.5-1.5L6 7v3z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <!-- Edit icon -->
        <svg v-else-if="iconType === 'edit'" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M3 2h10v12H3V2z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M5 5h3M5 8h4M5 11h3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          <path d="M10 8l2 2M10 11l2-2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
        <!-- Delete icon -->
        <svg v-else-if="iconType === 'delete'" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M3 2h10v12H3V2z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M6 6l4 4M10 6l-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
        <!-- Copy icon -->
        <svg v-else-if="iconType === 'copy'" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="5" y="5" width="9" height="9" rx="1" stroke="currentColor" stroke-width="1.5"/>
          <path d="M3 11V3a1 1 0 0 1 1-1h8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
        <!-- Move icon -->
        <svg v-else-if="iconType === 'move'" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M3 2h10v12H3V2z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M6 8h4M8 6l2 2-2 2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <!-- Bash/Terminal icon -->
        <svg v-else-if="iconType === 'bash'" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" stroke="currentColor" stroke-width="1.5"/>
          <path d="M4 6l2 2-2 2M7 10h3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <!-- Grep icon (search/magnifier) -->
        <svg v-else-if="iconType === 'grep'" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="6.5" cy="6.5" r="4" stroke="currentColor" stroke-width="1.5"/>
          <path d="M9.5 9.5l4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
        <!-- Glob icon -->
        <svg v-else-if="iconType === 'glob'" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="6.5" cy="6.5" r="4" stroke="currentColor" stroke-width="1.5"/>
          <path d="M9.5 9.5l4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
        <!-- Find icon -->
        <svg v-else-if="iconType === 'find'" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="6.5" cy="6.5" r="4" stroke="currentColor" stroke-width="1.5"/>
          <path d="M9.5 9.5l4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          <path d="M5 6.5h3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
        <!-- List Directory icon -->
        <svg v-else-if="iconType === 'list_directory'" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M2 3.5h4.5V8H2V3.5z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M2 10h12M2 13h12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          <path d="M8 3.5h6M8 6h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
        <!-- Agent icon -->
        <svg v-else-if="iconType === 'agent'" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M8 2l6 4v6l-6 4-6-4V6l6-4z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <!-- Skill icon -->
        <svg v-else-if="iconType === 'skill'" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M8 2l1.5 4.5H14l-3.75 3L12 14l-4-3-4 3 1.75-4.5L2 6.5h4.5L8 2z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <!-- MCP icon -->
        <svg v-else-if="iconType === 'mcp'" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5"/>
          <path d="M8 5v6M5 8h6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
        <!-- Image icon -->
        <svg v-else-if="iconType === 'image'" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="2" y="3" width="12" height="10" rx="1.5" stroke="currentColor" stroke-width="1.5"/>
          <circle cx="5.5" cy="6.5" r="1" fill="currentColor"/>
          <path d="M3 12l3.5-3.5L9 11l2-2 2 2.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <!-- Ask icon (chat bubble with question mark) -->
        <svg v-else-if="iconType === 'ask'" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M2 3.5A1.5 1.5 0 0 1 3.5 2h9A1.5 1.5 0 0 1 14 3.5v6A1.5 1.5 0 0 1 12.5 11H6l-3 3v-3H3.5A1.5 1.5 0 0 1 2 9.5v-6z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M6.5 5.5a1.5 1.5 0 0 1 2.4 1.2c0 1-1.4 1.1-1.4 2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          <circle cx="7.5" cy="10" r="0.4" fill="currentColor"/>
        </svg>
        <!-- Task icon -->
        <svg v-else-if="iconType === 'task'" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M3 2.5h10A1.5 1.5 0 0 1 14.5 4v8A1.5 1.5 0 0 1 13 13.5H3A1.5 1.5 0 0 1 1.5 12V4A1.5 1.5 0 0 1 3 2.5z" stroke="currentColor" stroke-width="1.5"/>
          <path d="M4.5 6l1.25 1.25L8 5M4.5 10h7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <!-- Plan icon -->
        <svg v-else-if="iconType === 'plan'" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="2" y="2" width="12" height="12" rx="1.5" stroke="currentColor" stroke-width="1.5"/>
          <path d="M5 2v2M11 2v2M2 6h12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          <circle cx="5.5" cy="9" r="0.5" fill="currentColor"/>
          <circle cx="8" cy="9" r="0.5" fill="currentColor"/>
          <circle cx="10.5" cy="9" r="0.5" fill="currentColor"/>
        </svg>
        <!-- Web/Fetch icon -->
        <svg v-else-if="iconType === 'web'" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5"/>
          <path d="M2 8h12M8 2c1.5 1.5 2 4 2 6s-.5 4.5-2 6M8 2c-1.5 1.5-2 4-2 6s.5 4.5 2 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
        <!-- Search icon -->
        <svg v-else-if="iconType === 'search'" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="7" cy="7" r="4.5" stroke="currentColor" stroke-width="1.5"/>
          <path d="M10 10l3.5 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          <path d="M7 4.5v5M4.5 7h5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
        </svg>
        <!-- Git icon -->
        <svg v-else-if="iconType === 'git'" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="4" cy="4" r="2" stroke="currentColor" stroke-width="1.5"/>
          <circle cx="12" cy="8" r="2" stroke="currentColor" stroke-width="1.5"/>
          <circle cx="4" cy="12" r="2" stroke="currentColor" stroke-width="1.5"/>
          <path d="M6 4h4M6 12h4M4 6v4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
        <!-- LSP icon -->
        <svg v-else-if="iconType === 'lsp'" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M2 8l3-3 3 3M14 8l-3 3-3-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M5 5v6M11 5v6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
        <!-- Notebook icon -->
        <svg v-else-if="iconType === 'notebook'" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="3" y="2" width="10" height="12" rx="1" stroke="currentColor" stroke-width="1.5"/>
          <path d="M3 5h10M3 9h10" stroke="currentColor" stroke-width="1.5"/>
          <circle cx="6" cy="3.5" r="0.5" fill="currentColor"/>
          <circle cx="6" cy="6.5" r="0.5" fill="currentColor"/>
          <circle cx="6" cy="11" r="0.5" fill="currentColor"/>
        </svg>
        <!-- Analyze icon -->
        <svg v-else-if="iconType === 'analyze'" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.5"/>
          <path d="M5 8h6M8 5l3 3-3 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <!-- Default icon -->
        <svg v-else viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="8" cy="8" r="2" fill="currentColor"/>
        </svg>
      </span>
      <span class="tool-call__name">{{ title }}</span>
      <span class="tool-call__summary">{{ summary }}</span>

      <span v-if="status === 'pending'" class="tool-call__pending">
        <span class="tool-call__spinner" />
        Running
      </span>
      <span v-else class="tool-call__result-summary">{{ resultSummary }}</span>
      <span v-if="status === 'error'" class="tool-call__error-icon">!</span>
      <span v-if="expandable" class="tool-call__chevron">
        <svg v-if="expanded" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M4 10l4-4 4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <svg v-else viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </span>
    </button>

    <div v-if="expanded" class="tool-call__body">
      <TerminalChrome
        v-if="toolName === 'bash' && command"
        :command="command"
        :description="description"
        :stdout="bash?.stdout"
        :stderr="bash?.stderr"
        :exit-code="bash?.exitCode"
        :status="bashStatus"
        :task-id="bash?.taskId"
        @cancel="emit('cancelBash', props.toolUseId, bash?.taskId)"
      />

      <DiffViewer v-else-if="toolName === 'edit_file' && (oldString || newString)" :file-path="filePath" :old-text="oldString" :new-text="newString" />
      <DiffViewer v-else-if="toolName === 'write_file' && content" :file-path="filePath" :content="content" />

      <div v-else-if="hasResult" class="tool-result-container" :class="{ 'tool-result-container--error': resultError }">
        <!-- 错误且能提炼主旨：默认只显示一句话，原始日志折叠 -->
        <template v-if="resultErrorSummary">
          <div class="tool-result-header">
            <span class="tool-result-summary-text">{{ resultErrorSummary }}</span>
            <button
              class="tool-result-toggle"
              type="button"
              @click.stop="rawResultCollapsed = !rawResultCollapsed"
            >
              {{ rawResultCollapsed ? '查看详情' : '收起' }}
            </button>
          </div>
          <pre v-if="!rawResultCollapsed" class="tool-result-content">{{ resultDisplayText
            }}<span v-if="resultTruncated && !resultExpanded" class="tool-result-ellipsis">
… 已截断 {{ resultFullText.length - RESULT_MAX_CHARS }} 字符</span></pre>
          <button
            v-if="!rawResultCollapsed && resultTruncated"
            class="tool-result-toggle tool-result-toggle--block"
            type="button"
            @click.stop="resultExpanded = !resultExpanded"
          >
            {{ resultExpanded ? '收起全部' : `显示全部 (${resultFullText.length} 字符)` }}
          </button>
        </template>

        <!-- 无主旨（成功结果或无法提炼）：沿用截断预览 -->
        <template v-else>
          <div class="tool-result-header">
            <span>{{ resultError ? '执行错误' : '执行结果' }}</span>
            <button
              v-if="resultTruncated"
              class="tool-result-toggle"
              type="button"
              @click.stop="resultExpanded = !resultExpanded"
            >
              {{ resultExpanded ? '收起' : `显示全部 (${resultFullText.length} 字符)` }}
            </button>
          </div>
          <pre class="tool-result-content">{{ resultDisplayText
            }}<span v-if="resultTruncated && !resultExpanded" class="tool-result-ellipsis">
… 已截断 {{ resultFullText.length - RESULT_MAX_CHARS }} 字符</span></pre>
        </template>
      </div>

      <div v-else-if="toolName === 'mcp'" class="tool-summary vertical">
        <div v-if="mcpAction"><span class="summary-label">操作</span><code>{{ mcpAction }}</code></div>
        <div v-if="mcpServer"><span class="summary-label">Server</span><code>{{ mcpServer }}</code></div>
        <div v-if="mcpTool"><span class="summary-label">Tool</span><code>{{ mcpTool }}</code></div>
        <div v-if="mcpUri"><span class="summary-label">URI</span><code>{{ mcpUri }}</code></div>
        <pre class="tool-json compact">{{ inputText }}</pre>
      </div>

      <div v-else-if="toolName === 'skill'" class="tool-summary vertical">
        <div v-if="skillName"><span class="summary-label">Skill</span><code>{{ skillName }}</code></div>
        <div v-if="skillArgs"><span class="summary-label">参数</span><code>{{ skillArgs }}</code></div>
        <pre class="tool-json compact">{{ inputText }}</pre>
      </div>

      <div v-else-if="toolName === 'image_gen'" class="tool-summary vertical">
        <div v-if="imagePrompt"><span class="summary-label">提示词</span><code>{{ imagePrompt }}</code></div>
        <div v-if="generatedImages.length > 0" class="image-gen-grid" :class="{ single: generatedImages.length === 1 }">
          <button
            v-for="(image, index) in generatedImages"
            :key="`${image.name}-${index}`"
            type="button"
            class="image-gen-card"
            @click="openImageAt(index)"
          >
            <img :src="image.src" :alt="image.name" loading="lazy" />
            <span class="image-gen-name">{{ image.name }}</span>
          </button>
        </div>
        <pre v-else class="tool-json compact">{{ inputText }}</pre>

        <ImageGalleryModal
          v-if="generatedImages.length > 0"
          v-model="modalOpen"
          :images="generatedImages"
          :initial-index="activeImageIndex"
        />
      </div>

      <div v-else-if="toolName === 'agent'" class="tool-summary vertical">
        <div v-if="description"><span class="summary-label">任务</span><code>{{ description }}</code></div>
        <div v-if="notification?.taskId"><span class="summary-label">Task</span><code>{{ notification.taskId }}</code></div>
        <div v-if="notification?.usage?.durationMs"><span class="summary-label">耗时</span><code>{{ notification.usage.durationMs }}ms</code></div>
        <pre v-if="notificationText" class="tool-json compact">{{ notificationText }}</pre>
        <pre v-else class="tool-json compact">{{ inputText }}</pre>
      </div>

      <div v-else-if="filePath" class="tool-summary">
        <span class="summary-label">路径</span>
        <code>{{ filePath }}</code>
      </div>

      <pre v-else class="tool-json">{{ inputText }}</pre>
    </div>
  </div>
</template>

<style scoped lang="scss">
.tool-call {
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--chat-color-border) 50%, transparent);
  border-radius: var(--chat-radius-md);
  background: var(--chat-color-surface-container-lowest);
}

.tool-call--error {
  border-color: color-mix(in srgb, var(--chat-color-error) 45%, var(--chat-color-border));
}

.tool-call__header {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border: 0;
  background: transparent;
  cursor: pointer;
  text-align: left;
  transition: background-color 150ms ease;

  &:hover {
    background: color-mix(in srgb, var(--chat-color-surface-hover) 80%, transparent);
  }
}

.tool-call__icon {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  color: var(--chat-color-outline);
  transition: color 200ms ease;

  svg {
    width: 100%;
    height: 100%;
  }
}

.tool-call__icon--active {
  color: var(--chat-color-warning);
}

.tool-call__name {
  flex-shrink: 0;
  color: var(--chat-color-text-secondary);
  font-size: 11px;
  font-weight: 700;
}

.tool-call__summary {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  color: var(--chat-color-text-tertiary);
  font-family: var(--chat-font-mono);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tool-call__pending,
.tool-call__result-summary {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  gap: 4px;
  color: var(--chat-color-outline);
  font-size: 10px;
}

.tool-call--error .tool-call__result-summary,
.tool-call__error-icon {
  color: var(--chat-color-error);
}

.tool-call__spinner {
  width: 12px;
  height: 12px;
  border: 2px solid color-mix(in srgb, var(--chat-color-outline) 30%, transparent);
  border-top-color: var(--chat-color-outline);
  border-radius: var(--chat-radius-full);
  animation: chat-spin 1s linear infinite;
}

.tool-call__chevron {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  color: var(--chat-color-outline);

  svg {
    width: 100%;
    height: 100%;
  }
}

.tool-call__body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border-top: 1px solid color-mix(in srgb, var(--chat-color-border) 60%, transparent);
}

.tool-summary {
  display: flex;
  gap: 8px;
  align-items: center;
  color: var(--chat-color-text-secondary);
  font-size: 12px;
}

.tool-summary.vertical {
  align-items: flex-start;
  flex-direction: column;
}

.tool-summary.vertical > div {
  display: flex;
  gap: 8px;
  align-items: center;
}

.summary-label {
  color: var(--chat-color-text-tertiary);
  font-size: 11px;
}

code,
.tool-json {
  font-family: var(--chat-font-mono);
  font-size: 11px;
}

.tool-json {
  max-height: 260px;
  overflow: auto;
  margin: 0;
  padding: 10px 12px;
  border-radius: var(--chat-radius-md);
  background: var(--chat-color-surface-container-low);
  color: var(--chat-color-text-secondary);
  line-height: 1.4;
  white-space: pre-wrap;
  word-break: break-word;
}

.tool-json.compact {
  max-height: 160px;
}

.image-gen-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  width: 100%;
}

.image-gen-grid.single {
  grid-template-columns: minmax(0, 1fr);
}

.image-gen-card {
  position: relative;
  overflow: hidden;
  padding: 0;
  border: 1px solid color-mix(in srgb, var(--chat-color-border) 60%, transparent);
  border-radius: var(--chat-radius-md);
  background: var(--chat-color-surface-container-low);
  cursor: pointer;
  text-align: left;
  transition: border-color 150ms ease, box-shadow 150ms ease;

  &:hover {
    border-color: color-mix(in srgb, var(--chat-color-primary, var(--chat-color-outline)) 50%, transparent);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.24);
  }

  img {
    display: block;
    width: 100%;
    max-height: 240px;
    object-fit: cover;
  }
}

.image-gen-name {
  display: block;
  overflow: hidden;
  padding: 4px 8px;
  color: var(--chat-color-text-tertiary);
  font-family: var(--chat-font-mono);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tool-result-container {
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--chat-color-border) 50%, transparent);
  border-radius: var(--chat-radius-md);
  background: var(--chat-color-surface-container-low);
}

.tool-result-container--error {
  border-color: color-mix(in srgb, var(--chat-color-error) 50%, transparent);
  background: color-mix(in srgb, var(--chat-color-error-container) 35%, var(--chat-color-surface-container-low));
}

.tool-result-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  border-bottom: 1px solid color-mix(in srgb, var(--chat-color-border) 45%, transparent);
  color: var(--chat-color-text-tertiary);
  font-size: 11px;
  font-weight: 600;
}

.tool-result-container--error .tool-result-header {
  color: var(--chat-color-error);
}

.tool-result-toggle {
  flex-shrink: 0;
  padding: 2px 8px;
  border: 1px solid color-mix(in srgb, var(--chat-color-border) 50%, transparent);
  border-radius: var(--chat-radius-full);
  background: transparent;
  color: var(--chat-color-text-tertiary);
  cursor: pointer;
  font-size: 10px;
  font-weight: 600;

  &:hover {
    color: var(--chat-color-text-primary);
    background: var(--chat-color-surface-container-low);
  }
}

/* 折叠原文下方的“显示全部”按钮，占整行 */
.tool-result-toggle--block {
  width: 100%;
  margin-top: 6px;
  text-align: center;
}

/* 错误主旨文本：可换行显示完整一句话 */
.tool-result-summary-text {
  flex: 1;
  min-width: 0;
  white-space: normal;
  word-break: break-word;
}

.tool-result-ellipsis {
  color: var(--chat-color-text-tertiary);
  font-style: italic;
}

.tool-result-content {
  max-height: 320px;
  overflow: auto;
  margin: 0;
  padding: 10px 12px;
  color: var(--chat-color-text-secondary);
  font-family: var(--chat-font-mono);
  font-size: 11px;
  line-height: 1.4;
  white-space: pre-wrap;
  word-break: break-word;
  /* 离屏时跳过内容渲染，降低长列表的布局成本 */
  content-visibility: auto;
  contain-intrinsic-size: auto 320px;
}

@media (max-width: 640px) {
  .tool-call__header {
    align-items: flex-start;
  }

  .tool-call__summary {
    display: none;
  }
}
</style>
