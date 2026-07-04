import type { AgentTaskNotification, AgentTranscriptBlock, Message, Session } from '../../types'

export interface BuildAgentNotificationInput {
  taskId: string
  toolUseId?: string
  status: AgentTaskNotification['status']
  summary?: string
  result?: string
  outputFile?: string
  usage?: AgentTaskNotification['usage']
  description?: string
  error?: string
  cwd?: string
  isolation?: AgentTaskNotification['isolation']
  worktreePath?: string
  timestamp?: string
}

export class TaskNotificationQueue {
  buildAgentNotification(input: BuildAgentNotificationInput): AgentTaskNotification | null {
    if (!input.toolUseId) return null

    return {
      taskId: input.taskId,
      toolUseId: input.toolUseId,
      status: input.status,
      summary: input.summary,
      result: input.result,
      outputFile: input.outputFile,
      usage: input.usage,
      timestamp: input.timestamp || new Date().toISOString(),
      description: input.description,
      error: input.error,
      cwd: input.cwd,
      isolation: input.isolation,
      worktreePath: input.worktreePath,
    }
  }

  enqueue(session: Session, notification: unknown, generateId: () => string): AgentTaskNotification | null {
    if (!this.isAgentTaskNotification(notification)) return null

    session.agentTaskNotifications ||= {}
    session.agentTaskNotifications[notification.toolUseId] = notification
    this.attachToTranscript(session, notification)
    session.messages.push(this.toSyntheticMessage(notification, generateId()))

    return notification
  }

  restore(session: Session): void {
    session.agentTaskNotifications ||= {}

    for (const block of session.transcript || []) {
      if (block.type !== 'tool_use') continue

      const indexed = session.agentTaskNotifications[block.toolUseId]
      const notification = indexed || block.notification
      if (!notification) continue

      session.agentTaskNotifications[block.toolUseId] = notification
      block.notification = notification
      block.isPending = false
    }
  }

  isAgentTaskNotification(value: unknown): value is AgentTaskNotification {
    return Boolean(
      value &&
        typeof value === 'object' &&
        typeof (value as Record<string, unknown>).taskId === 'string' &&
        typeof (value as Record<string, unknown>).toolUseId === 'string' &&
        ['completed', 'failed', 'stopped'].includes(String((value as Record<string, unknown>).status))
    )
  }

  private attachToTranscript(session: Session, notification: AgentTaskNotification): void {
    const toolUse = session.transcript?.find(
      (item): item is Extract<AgentTranscriptBlock, { type: 'tool_use' }> =>
        item.type === 'tool_use' && item.toolUseId === notification.toolUseId
    )
    if (!toolUse) return

    toolUse.notification = notification
    toolUse.isPending = false
  }

  private toSyntheticMessage(notification: AgentTaskNotification, id: string): Message {
    const resultText = notification.result || notification.summary || notification.error || ''
    return {
      id,
      role: 'user',
      content: `<task_notification taskId="${notification.taskId}" toolUseId="${notification.toolUseId}" status="${notification.status}">
${resultText}
</task_notification>`,
      timestamp: Date.now(),
    }
  }
}
