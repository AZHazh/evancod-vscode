import type { ToolCall } from '../../../types'

/**
 * 只读工具：同一入参重复调用必然得到相同结果（除非期间发生了写操作）。
 * 这类调用是「探查死循环」的载体，需要去重。
 */
const READ_ONLY_TOOLS = new Set([
  'read_file',
  'list_directory',
  'glob',
  'grep',
  'find',
  'lsp',
  'task_list',
  'task_get',
])

/**
 * 会让文件系统状态变化的工具。执行后必须清空缓存，
 * 否则改完文件再读会拿到过期内容。
 */
const MUTATING_TOOLS = new Set([
  'edit_file',
  'write_file',
  'delete_file',
  'move_file',
  'copy_file',
  'bash',
  'notebook_edit',
])

/**
 * 同一签名允许「回放缓存」的次数。超过后不再回灌正文，
 * 只回一条明确的制止信息，迫使模型改变策略。
 */
const MAX_CACHED_REPLAYS = 2

export type DedupDecision =
  | { kind: 'execute' }
  | { kind: 'replay'; content: string; contentBlocks?: unknown[] }
  | { kind: 'block'; content: string }

interface CacheEntry {
  content: string
  contentBlocks?: unknown[]
  repeats: number
}

/**
 * 工具调用去重器
 *
 * 解决的问题：模型在多轮工具循环中反复用相同入参调用同一个只读工具
 * （典型表现是来回重读同几个文件却不产出结论）。这种循环会一直烧到
 * maxIterations 才停，用户侧看起来就是「卡死在探查」。
 *
 * 策略分三级：
 * 1. 首次调用：正常执行并缓存结果。
 * 2. 重复调用（≤ MAX_CACHED_REPLAYS）：直接回放缓存，附带提醒。
 *    既省掉一次真实 IO，也让模型拿到数据继续推进。
 * 3. 继续重复：不再回灌正文，回一条制止信息，要求模型基于已有信息作答。
 *
 * 任何写操作都会让缓存失效，保证「改完再读」的正确性。
 */
export class ToolCallDeduplicator {
  private cache = new Map<string, CacheEntry>()

  /**
   * 判断一次工具调用应当执行、回放缓存，还是直接拦截。
   */
  inspect(toolCall: ToolCall): DedupDecision {
    if (!READ_ONLY_TOOLS.has(toolCall.name)) {
      return { kind: 'execute' }
    }

    const entry = this.cache.get(this.signature(toolCall))
    if (!entry) {
      return { kind: 'execute' }
    }

    entry.repeats++

    if (entry.repeats > MAX_CACHED_REPLAYS) {
      return {
        kind: 'block',
        content:
          `[已拦截重复调用] ${toolCall.name} 使用完全相同的入参已被调用 ${entry.repeats + 1} 次，` +
          '结果不会变化。请停止重复探查：基于已经获得的信息给出结论、执行修改，' +
          '或直接向用户说明还缺少什么。如果确实需要不同的信息，请更换入参或改用其他工具。',
      }
    }

    return {
      kind: 'replay',
      content:
        `[重复调用，以下为上次结果的缓存]\n注意：这次调用与之前完全相同，结果未变化。` +
        `请基于这些信息继续推进，不要再次调用。\n\n${entry.content}`,
      contentBlocks: entry.contentBlocks,
    }
  }

  /**
   * 记录一次真实执行的结果，供后续重复调用回放。
   * 写类工具执行后会顺带清空整个缓存。
   */
  record(toolCall: ToolCall, content: string, contentBlocks?: unknown[]): void {
    if (MUTATING_TOOLS.has(toolCall.name)) {
      // 文件系统已变化，之前缓存的读结果全部作废
      this.cache.clear()
      return
    }

    if (!READ_ONLY_TOOLS.has(toolCall.name)) {
      return
    }

    const signature = this.signature(toolCall)
    const existing = this.cache.get(signature)
    this.cache.set(signature, {
      content,
      contentBlocks,
      repeats: existing?.repeats ?? 0,
    })
  }

  /**
   * 本轮是否所有工具调用都被判定为重复（回放或拦截）。
   * QueryEngine 用它来识别「整轮没有实质进展」。
   */
  isNoProgress(decisions: DedupDecision[]): boolean {
    return decisions.length > 0 && decisions.every(decision => decision.kind !== 'execute')
  }

  reset(): void {
    this.cache.clear()
  }

  /**
   * 生成调用签名：工具名 + 稳定序列化的入参。
   * 键顺序不同但语义相同的入参必须命中同一签名。
   */
  private signature(toolCall: ToolCall): string {
    const input = toolCall.input ?? toolCall.args ?? {}
    return `${toolCall.name}:${stableStringify(input)}`
  }
}

/**
 * 稳定序列化：递归按键名排序，保证 {a:1,b:2} 与 {b:2,a:1} 得到同一字符串。
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null'
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)

  return `{${entries.join(',')}}`
}
