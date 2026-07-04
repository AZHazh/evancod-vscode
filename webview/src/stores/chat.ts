import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { useVSCode } from '@/composables/useVSCode'
import { useProviderStore } from './provider'
import { useAgentStore } from './agent'
import type { Session, UIMessage, AgentServerEvent, PermissionRequest, TokenUsage, AttachmentContext, SessionListItem } from '@/types'

export const useChatStore = defineStore('chat', () => {
  const vscode = useVSCode()
  const agentStore = useAgentStore()

  const currentSession = ref<Session | null>(null)
  const sessions = ref<Session[]>([])
  const isStreaming = ref(false)
  const providerStore = useProviderStore()
  const chatState = ref<'idle' | 'thinking' | 'running' | 'waiting_permission' | 'stopped'>('idle')
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

    agentTaskNotifications.value = { ...(currentSession.value.agentTaskNotifications || {}) }
    for (const block of currentSession.value.transcript || []) {
      if (block.type === 'tool_use' && block.notification) {
        agentTaskNotifications.value[block.toolUseId] = block.notification
      }
    }
    agentStore.restoreFromNotifications(agentTaskNotifications.value)

    if (currentSession.value.transcript?.length) {
      uiMessages.value = currentSession.value.transcript as UIMessage[]
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
    for (const message of currentSession.value.messages) {
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
          chatState.value = 'thinking'
          streamingText.value = ''
        } else {
          chatState.value = 'running'
          activeToolUseId.value = event.toolUseId ?? null
          activeToolName.value = event.toolName ?? null
          streamingToolInput.value = ''
        }
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
        chatState.value = 'running'
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
    const payload = {
      id: 'streaming-thinking',
      type: 'thinking' as const,
      content: text,
      timestamp: Date.now(),
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
    chatState.value = 'running'
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

    vscode.postMessage({
      type: 'permission_response',
      data: response,
    })

    pendingPermission.value = null
    chatState.value = response.approved ? 'running' : 'idle'
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
    isTaskToolUse,
  }
})

