import { defineStore } from 'pinia'
import { ref, computed, toRaw, isRef } from 'vue'
import { useVSCode } from '@/composables/useVSCode'
import { useProviderStore } from './provider'
import { useAgentStore } from './agent'
import type { Session, UIMessage, AgentServerEvent, PermissionRequest, TokenUsage, AttachmentContext, SessionListItem } from '@/types'

import { reorderTranscript } from '@/utils/messageGrouping'

type JsonSafeValue = string | number | boolean | null | JsonSafeValue[] | { [key: string]: JsonSafeValue }

function toPlainJsonSafe(value: unknown): JsonSafeValue | undefined {
  if (isRef(value)) {
    return toPlainJsonSafe(value.value)
  }

  const rawValue = toRaw(value)

  if (rawValue === null) return null

  const valueType = typeof rawValue
  if (valueType === 'string' || valueType === 'number' || valueType === 'boolean') {
    return rawValue as string | number | boolean
  }

  if (valueType === 'undefined' || valueType === 'function' || valueType === 'symbol' || valueType === 'bigint') {
    return undefined
  }

  if (Array.isArray(rawValue)) {
    return rawValue.map(item => toPlainJsonSafe(item) ?? null)
  }

  if (valueType === 'object') {
    const plainObject: { [key: string]: JsonSafeValue } = {}
    Object.entries(rawValue as Record<string, unknown>).forEach(([key, entryValue]) => {
      const plainValue = toPlainJsonSafe(entryValue)
      if (plainValue !== undefined) {
        plainObject[key] = plainValue
      }
    })
    return plainObject
  }

  return undefined
}

export const useChatStore = defineStore('chat', () => {
  const vscode = useVSCode()
  const agentStore = useAgentStore()

  const currentSession = ref<Session | null>(null)
  const sessions = ref<Session[]>([])
  const isStreaming = ref(false)
  const providerStore = useProviderStore()
  const chatState = ref<'idle' | 'thinking' | 'waiting_permission' | 'stopped'>('idle')
  const streamingText = ref('')
  const streamingToolInput = ref('')
  const activeToolUseId = ref<string | null>(null)
  const activeToolName = ref<string | null>(null)
  const pendingPermission = ref<PermissionRequest | null>(null)
  const tokenUsage = ref<TokenUsage | null>(null)
  const uiMessages = ref<UIMessage[]>([])
  const pendingOptimisticUserMessageIds = ref(new Set<string>())
  const agentTaskNotifications = ref<Record<string, NonNullable<Extract<UIMessage, { type: 'tool_use' }>['notification']>>>({})

  const currentModel = computed(() => providerStore.currentModel)
  const messages = computed(() => currentSession.value?.messages || [])

  function initialize() {
    window.addEventListener('message', handleMessage)
  }

  function createNewSession() {
    vscode.postMessage({
      type: 'session.new',
      data: null,
    })
  }

  function handleMessage(event: MessageEvent) {
    const message = event.data

    switch (message.type) {
      case 'session.restored':
        currentSession.value = message.data.session
        sessions.value = message.data.sessions
        syncUiMessagesFromSession()
        break

      case 'session.created':
        currentSession.value = message.data.session
        sessions.value.push(message.data.session)
        syncUiMessagesFromSession()
        break

      case 'session.list':
        sessions.value = mergeSessionList(message.data.sessions || [])
        break

      case 'chat.status':
        chatState.value = message.data.state === 'idle' ? 'idle' : message.data.state
        break

      case 'chat.messages.update':
        if (message.data.session) {
          currentSession.value = message.data.session
        } else if (currentSession.value) {
          currentSession.value.messages = message.data.messages
        }
        syncUiMessagesFromSession(true)
        break

      case 'chat.message.stream':
        handleStreamMessage(message.data)
        break

      case 'agent.event':
        handleAgentEvent(message.data)
        break

      case 'error':
        console.error('Extension error:', message.data.message)
        break
    }
  }

  function mergeSessionList(items: SessionListItem[]): Session[] {
    const map = new Map(sessions.value.map(session => [session.id, session]))
    for (const item of items) {
      const existing = map.get(item.id)
      map.set(item.id, {
        id: item.id,
        name: item.title,
        createdAt: new Date(item.createdAt).getTime(),
        updatedAt: new Date(item.modifiedAt).getTime(),
        messages: existing?.messages || [],
        workDir: item.workDir || existing?.workDir || '',
        transcript: existing?.transcript,
        agentTaskNotifications: existing?.agentTaskNotifications,
        runtimeConfig: existing?.runtimeConfig,
        tokenUsage: existing?.tokenUsage,
        compactSummary: existing?.compactSummary,
        attachments: existing?.attachments,
        messageCount: existing?.messageCount ?? existing?.messages?.length ?? 0,
      })
    }
    return [...map.values()].sort((a, b) => b.updatedAt - a.updatedAt)
  }

  function syncUiMessagesFromSession(preserveRuntime = false) {
    if (!currentSession.value) {
      uiMessages.value = []
      agentTaskNotifications.value = {}
      return
    }

    // 性能优化：如果是追加模式且已有消息，只处理新增的部分
    const existingCount = uiMessages.value.filter(m => !m.id.startsWith('optimistic-') && !m.id.startsWith('streaming-')).length
    const isAppendMode = preserveRuntime && existingCount > 0 && currentSession.value.messages.length > existingCount

    // 合并 agentTaskNotifications，保留本地已有的通知（避免被后端旧数据覆盖）
    const incomingNotifications = currentSession.value.agentTaskNotifications || {}
    console.log('[syncUiMessages] incoming notifications:', Object.keys(incomingNotifications).length, incomingNotifications)
    agentTaskNotifications.value = {
      ...agentTaskNotifications.value,
      ...incomingNotifications,
    }
    console.log('[syncUiMessages] merged notifications:', Object.keys(agentTaskNotifications.value).length, agentTaskNotifications.value)

    let transcriptNotificationCount = 0
    for (const block of currentSession.value.transcript || []) {
      if (block.type === 'tool_use') {
        if (block.notification) {
          agentTaskNotifications.value[block.toolUseId] = block.notification
          transcriptNotificationCount++
        } else if (block.toolName === 'agent' && !block.isPending) {
          // 兜底：如果 agent 工具没有 notification 但已经不是 pending 状态，
          // 说明是旧数据或者通知丢失，创建一个默认的完成状态
          const fallbackNotification = {
            taskId: block.toolUseId,
            toolUseId: block.toolUseId,
            status: 'completed' as const,
            summary: '执行完成（历史数据）',
            timestamp: new Date(block.timestamp || Date.now()).toISOString(),
          }
          agentTaskNotifications.value[block.toolUseId] = fallbackNotification
          transcriptNotificationCount++
        }
      }
    }
    console.log('[syncUiMessages] from transcript:', transcriptNotificationCount, 'agent tools:',
      currentSession.value.transcript?.filter(b => b.type === 'tool_use' && (b as any).toolName === 'agent').length)
    agentStore.restoreFromNotifications(agentTaskNotifications.value)

    if (currentSession.value.transcript?.length) {
      // 保留内存中已有的图片 base64，避免 transcript 重建（读盘可能缺失）时闪掉刚展示的图片
      const existingImageBase64 = new Map<string, string>()
      for (const message of uiMessages.value) {
        if (message.type === 'image_generation' && message.image?.base64) {
          existingImageBase64.set(message.imageId, message.image.base64)
        }
      }

      const reordered = reorderTranscript(currentSession.value.transcript) as UIMessage[]
      uiMessages.value = reordered.map(message => {
        if (message.type !== 'image_generation') return message
        if (message.image?.base64) return message
        const cached = existingImageBase64.get(message.imageId)
        if (!cached) return message
        return {
          ...message,
          image: message.image
            ? { ...message.image, base64: cached }
            : { base64: cached, mime: 'image/png' },
        }
      })
      tokenUsage.value = currentSession.value.tokenUsage || null
      return
    }

    const existingRuntime = preserveRuntime
      ? new Map(
          uiMessages.value
            .filter((message): message is Extract<UIMessage, { type: 'tool_use' }> => message.type === 'tool_use')
            .map(message => [message.toolUseId, message])
        )
      : new Map<string, Extract<UIMessage, { type: 'tool_use' }>>()

    const nextMessages: UIMessage[] = []

    // 性能优化：追加模式时，复用现有消息
    let startIndex = 0
    if (isAppendMode) {
      // 复用已有的消息（除了临时消息）
      nextMessages.push(...uiMessages.value.filter(m => !m.id.startsWith('optimistic-') && !m.id.startsWith('streaming-')))
      startIndex = existingCount
    }

    for (let i = startIndex; i < currentSession.value.messages.length; i++) {
      const message = currentSession.value.messages[i]
      if (message.role === 'user') {
        nextMessages.push({
          id: message.id,
          type: 'user_text',
          content: message.content,
          timestamp: message.timestamp,
        })
        continue
      }

      if (message.role === 'assistant') {
        if (message.content) {
          nextMessages.push({
            id: message.id,
            type: 'assistant_text',
            content: message.content,
            timestamp: message.timestamp,
          })
        }

        const toolCalls = (message as any).toolCalls || []
        for (const toolCall of toolCalls) {
          const existing = existingRuntime.get(toolCall.id)
          nextMessages.push({
            id: toolCall.id,
            type: 'tool_use',
            toolName: toolCall.name,
            toolUseId: toolCall.id,
            input: toolCall.input ?? toolCall.args ?? null,
            timestamp: toolCall.startTime || message.timestamp,
            isPending: existing?.isPending ?? (toolCall.status === 'pending' || toolCall.status === 'running'),
            bash: existing?.bash,
            notification: existing?.notification || agentTaskNotifications.value[toolCall.id],
          })
        }
        continue
      }

      if (message.role === 'tool') {
        const toolUseId = (message as any).toolCallId || message.id
        if ((message as any).toolName === 'bash') {
          mergeBashToolResult(nextMessages, toolUseId, message.content)
          continue
        }

        nextMessages.push({
          id: `${toolUseId}:result`,
          type: 'tool_result',
          toolUseId,
          content: message.content,
          isError: false,
          timestamp: message.timestamp,
        })
      }
    }

    uiMessages.value = removeReconciledOptimisticMessages(nextMessages)
  }

  function removeReconciledOptimisticMessages(nextMessages: UIMessage[]) {
    const serverUserMessages = new Set(
      nextMessages
        .filter((message): message is Extract<UIMessage, { type: 'user_text' }> => message.type === 'user_text' && !message.id.startsWith('optimistic-user-'))
        .map(message => normalizeUserContent(message.content))
    )

    return nextMessages.filter(message => {
      if (message.type !== 'user_text' || !message.id.startsWith('optimistic-user-')) return true
      const matched = serverUserMessages.has(normalizeUserContent(message.content))
      if (matched) pendingOptimisticUserMessageIds.value.delete(message.id)
      return !matched
    })
  }

  function normalizeUserContent(content: string) {
    return content.trim().replace(/\s+/g, ' ')
  }

  function upsertPlanApprovalMessage(plan: import('./plan').Plan) {
    const id = `plan-approval-${plan.id}`
    const existingIndex = uiMessages.value.findIndex(message => message.type === 'plan_approval' && message.plan.id === plan.id)
    const nextMessage: UIMessage = {
      id,
      type: 'plan_approval',
      plan,
      timestamp: new Date(plan.createdAt).getTime() || Date.now(),
    }

    if (existingIndex >= 0) {
      uiMessages.value.splice(existingIndex, 1, nextMessage)
    } else {
      uiMessages.value.push(nextMessage)
    }
  }

  function updatePlanApprovalMessage(planId: string, updater: (plan: import('./plan').Plan) => void) {
    const message = uiMessages.value.find(message => message.type === 'plan_approval' && message.plan.id === planId)
    if (!message || message.type !== 'plan_approval') return
    updater(message.plan)
  }

  function handleStreamMessage(data: { content: string; delta: boolean }) {
    if (!currentSession.value) return

    if (data.delta) {
      const lastMessage = currentSession.value.messages[currentSession.value.messages.length - 1]
      if (lastMessage && lastMessage.role === 'assistant') {
        lastMessage.content += data.content
      }
    } else {
      const message = {
        id: `${Date.now()}-${Math.random()}`,
        role: 'assistant' as const,
        content: data.content,
        timestamp: Date.now(),
      }
      currentSession.value.messages.push(message)
    }

    syncUiMessagesFromSession()
  }

  function handleAgentEvent(event: AgentServerEvent) {
    switch (event.type) {
      case 'content_start':
        if (event.blockType === 'text') {
          streamingText.value = ''
        } else {
          activeToolUseId.value = event.toolUseId ?? null
          activeToolName.value = event.toolName ?? null
          streamingToolInput.value = ''
        }
        chatState.value = 'thinking'
        break

      case 'content_delta':
        if (typeof event.text === 'string') {
          streamingText.value += event.text
          upsertAssistantText()
        }
        if (typeof event.toolInput === 'string') {
          streamingToolInput.value += event.toolInput
          upsertToolUse()
        }
        break

      case 'tool_use_complete':
        upsertToolUse({
          toolName: event.toolName,
          toolUseId: event.toolUseId,
          input: event.input,
          parentToolUseId: event.parentToolUseId,
        })
        activeToolUseId.value = event.toolUseId
        activeToolName.value = event.toolName
        chatState.value = 'thinking'
        break

      case 'tool_result':
        applyBashToolResult(event)
        if (!isBashToolUse(event.toolUseId)) {
          upsertToolResult(event)
        }
        if (isTaskToolUse(event.toolUseId)) {
          vscode.postMessage({
            type: 'task.list.refresh',
            data: null,
          })
        }
        break

      case 'bash_output':
        appendBashOutput(event.toolUseId, event.stream, event.text, event.taskId)
        break

      case 'bash_status':
        updateBashStatus(event.toolUseId, event.status, event.exitCode, event.taskId)
        break

      case 'permission_request':
        pendingPermission.value = {
          requestId: event.requestId,
          toolName: event.toolName,
          toolUseId: event.toolUseId,
          input: event.input,
          description: event.description,
        }
        chatState.value = 'waiting_permission'
        uiMessages.value.push({
          id: event.requestId,
          type: 'permission_request',
          requestId: event.requestId,
          toolName: event.toolName,
          toolUseId: event.toolUseId,
          input: event.input,
          description: event.description,
          timestamp: Date.now(),
          responseState: 'pending',
        })
        break

      case 'thinking':
        chatState.value = 'thinking'
        streamingText.value = event.text
        upsertThinkingBlock(event.text)
        break

      case 'image_generation':
        upsertImageGeneration(event)
        chatState.value = 'thinking'
        break

      case 'system_notification':
        if (event.subtype === 'task_notification') {
          applyTaskNotification(event.data)
        }
        break

      case 'message_complete':
        chatState.value = 'idle'
        isStreaming.value = false
        streamingText.value = ''
        streamingToolInput.value = ''
        activeToolUseId.value = null
        activeToolName.value = null
        pendingPermission.value = null
        tokenUsage.value = (event.usage || null) as TokenUsage | null
        break

      case 'status':
        chatState.value = event.state as any
        break
    }
  }

  function upsertAssistantText() {
    const existingIndex = uiMessages.value.findIndex(message => message.type === 'assistant_text' && message.id === 'streaming-assistant')
    const payload = {
      id: 'streaming-assistant',
      type: 'assistant_text' as const,
      content: streamingText.value,
      timestamp: Date.now(),
    }

    if (existingIndex === -1) {
      uiMessages.value.push(payload)
      return
    }

    uiMessages.value.splice(existingIndex, 1, payload)
  }

  function upsertThinkingBlock(text: string) {
    const existingIndex = uiMessages.value.findIndex(message => message.type === 'thinking' && message.id === 'streaming-thinking')
    const existing = existingIndex === -1 ? null : uiMessages.value[existingIndex]
    const payload = {
      id: 'streaming-thinking',
      type: 'thinking' as const,
      content: existing && existing.type === 'thinking' ? `${existing.content}${text}` : text,
      timestamp: existing?.timestamp ?? Date.now(),
    }

    if (existingIndex === -1) {
      uiMessages.value.push(payload)
      return
    }

    uiMessages.value.splice(existingIndex, 1, payload)
  }

  function upsertImageGeneration(event: Extract<AgentServerEvent, { type: 'image_generation' }>) {
    const id = `imggen:${event.imageId}`
    const existingIndex = uiMessages.value.findIndex(
      message => message.type === 'image_generation' && message.imageId === event.imageId
    )
    const existing = existingIndex === -1 ? null : uiMessages.value[existingIndex]
    const existingImage = existing?.type === 'image_generation' ? existing.image : undefined

    const payload = {
      id,
      type: 'image_generation' as const,
      imageId: event.imageId,
      timestamp: existing?.timestamp ?? Date.now(),
      isPending: event.phase === 'start',
      prompt: event.prompt ?? (existing?.type === 'image_generation' ? existing.prompt : undefined),
      image: event.phase === 'complete' ? event.image : existingImage,
    }

    if (existingIndex === -1) {
      uiMessages.value.push(payload)
      return
    }

    uiMessages.value.splice(existingIndex, 1, payload)
  }

  function upsertToolUse(input?: { toolName: string; toolUseId: string; input: unknown; parentToolUseId?: string }) {
    if (!activeToolUseId.value && !input?.toolUseId) return

    const toolUseId = input?.toolUseId || activeToolUseId.value || ''
    const toolName = input?.toolName || activeToolName.value || ''
    const partialInput = streamingToolInput.value || undefined
    const existingIndex = uiMessages.value.findIndex(message => message.type === 'tool_use' && message.toolUseId === toolUseId)
    const existingItem = existingIndex === -1 || uiMessages.value[existingIndex].type !== 'tool_use'
      ? null
      : uiMessages.value[existingIndex]
    const nextItem = {
      id: toolUseId,
      type: 'tool_use' as const,
      toolName,
      toolUseId,
      input: input?.input ?? partialInput ?? null,
      timestamp: Date.now(),
      isPending: existingItem?.isPending ?? true,
      partialInput,
      parentToolUseId: input?.parentToolUseId,
      bash: existingItem?.bash,
      notification: existingItem?.notification,
    }

    if (existingIndex === -1) {
      uiMessages.value.push(nextItem)
      return
    }

    uiMessages.value.splice(existingIndex, 1, nextItem)
  }

  function upsertToolResult(event: Extract<AgentServerEvent, { type: 'tool_result' }>) {
    const payload = {
      id: `${event.toolUseId}:result`,
      type: 'tool_result' as const,
      toolUseId: event.toolUseId,
      content: event.content,
      isError: event.isError,
      timestamp: Date.now(),
      parentToolUseId: event.parentToolUseId,
    }

    const existingIndex = uiMessages.value.findIndex(message => message.type === 'tool_result' && message.toolUseId === event.toolUseId)
    if (existingIndex === -1) {
      uiMessages.value.push(payload)
      return
    }

    uiMessages.value.splice(existingIndex, 1, payload)
  }

  function applyTaskNotification(data: unknown) {
    if (!data || typeof data !== 'object' || !('toolUseId' in data)) return
    const notification = data as Extract<UIMessage, { type: 'tool_use' }>['notification']
    if (!notification) return

    agentTaskNotifications.value[notification.toolUseId] = notification
    agentStore.applyNotification(notification)
    if (currentSession.value) {
      currentSession.value.agentTaskNotifications = {
        ...(currentSession.value.agentTaskNotifications || {}),
        [notification.toolUseId]: notification,
      }
    }

    const index = uiMessages.value.findIndex(
      (message): message is Extract<UIMessage, { type: 'tool_use' }> =>
        message.type === 'tool_use' && message.toolUseId === notification.toolUseId
    )
    if (index === -1 || uiMessages.value[index].type !== 'tool_use') return

    uiMessages.value.splice(index, 1, {
      ...uiMessages.value[index],
      isPending: false,
      notification,
    })
  }

  function updateBashMessage(
    toolUseId: string,
    updater: (message: Extract<UIMessage, { type: 'tool_use' }>) => Extract<UIMessage, { type: 'tool_use' }>
  ) {
    const index = uiMessages.value.findIndex(message => message.type === 'tool_use' && message.toolUseId === toolUseId)
    if (index === -1 || uiMessages.value[index].type !== 'tool_use') return
    uiMessages.value.splice(index, 1, updater(uiMessages.value[index]))
  }

  function appendBashOutput(toolUseId: string, stream: 'stdout' | 'stderr', text: string, taskId?: string) {
    updateBashMessage(toolUseId, message => {
      const bash = message.bash || { stdout: '', stderr: '' }
      return {
        ...message,
        bash: {
          ...bash,
          taskId: taskId || bash.taskId,
          status: bash.status || 'running',
          stdout: stream === 'stdout' ? `${bash.stdout}${text}` : bash.stdout,
          stderr: stream === 'stderr' ? `${bash.stderr}${text}` : bash.stderr,
        },
      }
    })
  }

  function updateBashStatus(toolUseId: string, status: NonNullable<NonNullable<Extract<UIMessage, { type: 'tool_use' }>['bash']>['status']>, exitCode?: number | null, taskId?: string) {
    updateBashMessage(toolUseId, message => {
      const bash = message.bash || { stdout: '', stderr: '' }
      return {
        ...message,
        isPending: status === 'running',
        bash: {
          ...bash,
          status,
          exitCode,
          taskId: taskId || bash.taskId,
        },
      }
    })
  }

  function applyBashToolResult(event: Extract<AgentServerEvent, { type: 'tool_result' }>) {
    const toolUse = uiMessages.value.find(
      (message): message is Extract<UIMessage, { type: 'tool_use' }> =>
        message.type === 'tool_use' && message.toolUseId === event.toolUseId
    )
    if (!toolUse || toolUse.toolName !== 'bash') return

    mergeBashToolResult(uiMessages.value, event.toolUseId, event.content, event.isError)
  }

  function mergeBashToolResult(messages: UIMessage[], toolUseId: string, content: unknown, isError = false) {
    const index = messages.findIndex(
      (message): message is Extract<UIMessage, { type: 'tool_use' }> =>
        message.type === 'tool_use' && message.toolUseId === toolUseId && message.toolName === 'bash'
    )
    if (index === -1 || messages[index].type !== 'tool_use') return

    const parsed = parseToolResultContent(content)
    const metadata = parsed?.metadata
    const bash = messages[index].bash || { stdout: '', stderr: '' }
    const status = metadata?.cancelled
      ? 'cancelled'
      : metadata?.timedOut
        ? 'timeout'
        : isError || parsed?.success === false
          ? 'error'
          : 'completed'

    messages.splice(index, 1, {
      ...messages[index],
      isPending: false,
      bash: {
        ...bash,
        stdout: typeof metadata?.stdout === 'string' && !bash.stdout ? metadata.stdout : bash.stdout,
        stderr: typeof metadata?.stderr === 'string' && !bash.stderr ? metadata.stderr : bash.stderr,
        exitCode: typeof metadata?.exitCode === 'number' || metadata?.exitCode === null ? metadata.exitCode : bash.exitCode,
        taskId: typeof metadata?.taskId === 'string' ? metadata.taskId : bash.taskId,
        status,
      },
    })
  }

  function parseToolResultContent(content: unknown): { success?: boolean; metadata?: Record<string, any> } | null {
    if (typeof content !== 'string') return null
    try {
      const parsed = JSON.parse(content)
      return typeof parsed === 'object' && parsed !== null ? parsed : null
    } catch {
      return null
    }
  }

  function isBashToolUse(toolUseId: string) {
    const toolUse = uiMessages.value.find(
      (item): item is Extract<(typeof uiMessages.value)[number], { type: 'tool_use' }> =>
        item.type === 'tool_use' && item.toolUseId === toolUseId
    )
    return !!toolUse && toolUse.toolName === 'bash'
  }

  function isTaskToolUse(toolUseId: string) {
    const taskLikeMessage = uiMessages.value.find(
      (item): item is Extract<(typeof uiMessages.value)[number], { type: 'tool_use' }> =>
        item.type === 'tool_use' && item.toolUseId === toolUseId
    )
    return !!taskLikeMessage && taskLikeMessage.toolName.startsWith('task_')
  }

  function updatePermissionResponseState(requestId: string, responseState: 'approved' | 'denied') {
    const index = uiMessages.value.findIndex(
      message => message.type === 'permission_request' && message.requestId === requestId
    )
    if (index === -1 || uiMessages.value[index].type !== 'permission_request') return

    uiMessages.value.splice(index, 1, {
      ...uiMessages.value[index],
      responseState,
    })
  }

  function sendMessage(content: string, files: (string | AttachmentContext)[] = []) {
    // 检查是否为内置命令（不需要 AI 处理的命令）
    const trimmed = content.trim()
    const isBuiltinCommand = /^\/(clear|clean|new|compact|help)(\s|$)/i.test(trimmed)

    const optimisticId = `optimistic-user-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
    const optimisticMessage: UIMessage = {
      id: optimisticId,
      type: 'user_text',
      content,
      timestamp: Date.now(),
      attachments: files.filter((file): file is AttachmentContext => typeof file !== 'string'),
    }

    pendingOptimisticUserMessageIds.value.add(optimisticId)
    uiMessages.value.push(optimisticMessage)

    // 只有非内置命令才设置为 thinking 状态
    if (!isBuiltinCommand) {
      chatState.value = 'thinking'
    }

    vscode.postMessage({
      type: 'chat.send',
      data: { content, files }
    })
  }

  function stopGeneration() {
    vscode.postMessage({
      type: 'chat.stop',
      data: { sessionId: currentSession.value?.id },
    })
    chatState.value = 'idle'
    pendingPermission.value = null
    streamingText.value = ''
    streamingToolInput.value = ''
    activeToolUseId.value = null
    activeToolName.value = null
  }

  function openSession(sessionId: string) {
    vscode.postMessage({
      type: 'session.load',
      data: { sessionId },
    })
  }

  function fetchSessions() {
    vscode.postMessage({
      type: 'session.list.request',
      data: null,
    })
  }

  function cancelBash(toolUseId: string, taskId?: string) {
    vscode.postMessage({
      type: 'bash.cancel',
      data: { toolUseId, taskId },
    })
  }

  function sendPermissionResponse(response: { requestId: string; approved: boolean; reason?: string; updatedInput?: unknown; rule?: 'once' | 'always' }) {
    updatePermissionResponseState(response.requestId, response.approved ? 'approved' : 'denied')

    const plainResponse = toPlainJsonSafe(response)
    vscode.postMessage({
      type: 'permission_response',
      data: plainResponse,
    })

    pendingPermission.value = null
    chatState.value = response.approved ? 'thinking' : 'idle'
  }

  return {
    currentSession,
    sessions,
    isStreaming,
    currentModel,
    messages,
    uiMessages,
    agentTaskNotifications,
    chatState,
    streamingText,
    streamingToolInput,
    activeToolUseId,
    activeToolName,
    pendingPermission,
    tokenUsage,
    initialize,
    createNewSession,
    sendMessage,
    stopGeneration,
    openSession,
    fetchSessions,
    cancelBash,
    sendPermissionResponse,
    upsertPlanApprovalMessage,
    updatePlanApprovalMessage,
    isTaskToolUse,
  }
})

