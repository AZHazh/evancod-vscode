import type { UIMessage } from '../types'

export interface ToolActivityGroup {
  id: string
  type: 'tool_activity_group'
  messages: UIMessage[]
}

export type ActivityItem = UIMessage | ToolActivityGroup

/** 只投影展示，保留原始工具、结果及授权记录；正文和交互始终是分组边界。 */
export function groupToolActivity(messages: UIMessage[]): ActivityItem[] {
  const items: ActivityItem[] = []
  let group: ToolActivityGroup | undefined
  for (const message of messages) {
    if (message.type === 'permission_request') continue
    if (message.type === 'tool_use' || message.type === 'tool_result') {
      if (!group) {
        group = { id: `activity:${message.id}`, type: 'tool_activity_group', messages: [] }
        items.push(group)
      }
      group.messages.push(message)
    } else {
      group = undefined
      items.push(message)
    }
  }
  return items
}

/** 仅根据真实工具事件汇总状态；没有结果的历史记录不推断成功。 */
export function summarizeToolActivity(messages: UIMessage[]) {
  const tools = messages.filter(
    (message): message is Extract<UIMessage, { type: 'tool_use' }> => message.type === 'tool_use'
  )
  const results = messages.filter(
    (message): message is Extract<UIMessage, { type: 'tool_result' }> =>
      message.type === 'tool_result'
  )
  const errors = new Set(results.filter(result => result.isError).map(result => result.toolUseId))
  let running = 0
  let cancelled = 0
  for (const tool of tools) {
    if (tool.isPending) running++
    if (
      tool.executionStatus === 'cancelled' ||
      tool.bash?.status === 'cancelled' ||
      tool.notification?.status === 'stopped'
    ) cancelled++
    if (
      tool.bash?.status === 'error' ||
      tool.bash?.status === 'timeout' ||
      tool.executionStatus === 'failed' ||
      tool.notification?.status === 'failed' ||
      ('resultError' in tool && tool.resultError)
    ) {
      errors.add(tool.toolUseId)
    }
  }
  const categories: string[] = []
  const labels: Record<string, string> = {
    read_file: '读取',
    grep: '搜索',
    glob: '搜索',
    edit_file: '编辑',
    write_file: '写入',
    bash: '命令',
    agent: 'Agent',
    image_gen: '图片',
  }
  for (const tool of tools) {
    const label = labels[tool.toolName] || (tool.toolName.startsWith('task_') ? '任务' : tool.toolName)
    if (!categories.includes(label)) categories.push(label)
  }
  const count = tools.length || new Set(results.map(result => result.toolUseId)).size
  return { count, running, cancelled, errors: errors.size, categories }
}
