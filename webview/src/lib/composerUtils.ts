import type { SlashCommand, WorkspaceReference } from '@/types'

export const FALLBACK_SLASH_COMMANDS: SlashCommand[] = [
  { name: 'help', description: '查看 Evancod 帮助' },
  { name: 'clear', description: '清空当前会话' },
  { name: 'new', description: '创建新会话' },
  { name: 'compact', description: '压缩当前会话上下文' },
  { name: 'commit', description: '快速创建 Git 提交', argumentHint: '<提交消息>' },
  { name: 'history', description: '查看 Git 提交历史', argumentHint: '[数量]' },
  { name: 'context', description: '查看上下文使用情况' },
]

export function normalizeSlashCommand(command: SlashCommand): SlashCommand {
  const rawName = command.name || command.command || ''
  return {
    ...command,
    name: rawName.replace(/^\//, ''),
    description: command.description || command.desc,
    argumentHint: command.argumentHint || command.usage,
  }
}

export function mergeSlashCommands(commands: SlashCommand[]) {
  const map = new Map<string, SlashCommand>()
  for (const command of [...FALLBACK_SLASH_COMMANDS, ...commands].map(normalizeSlashCommand)) {
    if (command.name) map.set(command.name, command)
  }
  return [...map.values()]
}

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

export function filterSlashCommands(commands: SlashCommand[], filter: string) {
  const q = filter.trim().toLowerCase()
  if (!q) return commands

  return commands
    .map(command => {
      const normalized = normalizeSlashCommand(command)
      const name = normalized.name.toLowerCase()
      const description = normalized.description?.toLowerCase() ?? ''
      const argumentHint = normalized.argumentHint?.toLowerCase() ?? ''

      let score = 0
      if (name === q) score += 100
      else if (name.startsWith(q)) score += 80
      else if (name.includes(q)) score += 50
      if (description.includes(q)) score += 20
      if (argumentHint.includes(q)) score += 10

      return { command: normalized, score }
    })
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || a.command.name.localeCompare(b.command.name))
    .map(item => item.command)
}

export function formatWorkspaceReferencePrompt(references: WorkspaceReference[]) {
  if (!references.length) return ''
  return [
    '用户引用了以下工作区文件或目录：',
    ...references.map(ref => `- @${ref.relativePath}`),
  ].join('\n')
}
