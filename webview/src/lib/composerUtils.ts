import type { SkillEntry, SlashCommand, WorkspaceReference } from '@/types'

export const FALLBACK_SLASH_COMMANDS: SlashCommand[] = [
  { name: 'help', description: '查看 Evancod 帮助' },
  { name: 'clear', description: '清空当前会话' },
  { name: 'new', description: '创建新会话' },
  { name: 'compact', description: '压缩当前会话上下文' },
  { name: 'commit', description: '快速创建 Git 提交', argumentHint: '<提交消息>' },
  { name: 'history', description: '查看 Git 提交历史', argumentHint: '[数量]' },
  { name: 'context', description: '查看上下文使用情况' },
  { name: 'skill-list', description: '浏览并选择可用技能', argumentHint: '[关键字]' },
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

/**
 * 检测光标前是否处于 `/skill-list` 触发态。
 * 命中时返回 { start, filter }：start 指向 `/` 的位置，filter 为命令后的关键字。
 * 需优先于 findSlashTrigger 调用，否则 `/skill-list` 会被当作普通斜杠命令处理。
 */
export function findSkillListTrigger(value: string, cursor: number) {
  const beforeCursor = value.slice(0, cursor)
  const slashIndex = beforeCursor.lastIndexOf('/')
  if (slashIndex < 0) return null

  const prev = slashIndex === 0 ? '' : beforeCursor[slashIndex - 1]
  if (slashIndex > 0 && !/\s/.test(prev)) return null

  const rest = beforeCursor.slice(slashIndex + 1)
  // 匹配 "skill-list" 或 "skill-list <关键字>"（关键字不含换行）
  const match = rest.match(/^skill-list(?:\s+([^\n]*))?$/)
  if (!match) return null

  return { start: slashIndex, filter: match[1] ?? '' }
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

export function filterSkills(skills: SkillEntry[], filter: string) {
  const q = filter.trim().toLowerCase()
  if (!q) return skills

  return skills
    .map(skill => {
      const name = skill.name.toLowerCase()
      const description = skill.description?.toLowerCase() ?? ''

      let score = 0
      if (name === q) score += 100
      else if (name.startsWith(q)) score += 80
      else if (name.includes(q)) score += 50
      if (description.includes(q)) score += 20

      return { skill, score }
    })
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || a.skill.name.localeCompare(b.skill.name))
    .map(item => item.skill)
}

/**
 * 选中技能后插入到输入框的自然语言指令。
 * 让模型据此按需调用 skill 工具加载正文，而非直接下发技能内容。
 */
export function formatSkillPrompt(skill: SkillEntry) {
  const desc = skill.description ? `（${skill.description}）` : ''
  return `使用 ${skill.name} 技能${desc}，`
}

export function formatWorkspaceReferencePrompt(references: WorkspaceReference[]) {
  if (!references.length) return ''
  return [
    '用户引用了以下工作区文件或目录：',
    ...references.map(ref => `- @${ref.relativePath}`),
  ].join('\n')
}
