/**
 * 模型输出退化检测。
 *
 * 长输出时模型可能陷入「同一短语无限复读」（例如反复输出"立即执行。Now."），
 * 轮次级断路器（重复工具调用 / 重复错误）对没有工具调用的单次响应无效，
 * 只能等 max_tokens 截断，而截断续跑又会把复读文本写回历史继续放大。
 * 这里在流式阶段用滑动窗口检测，发现退化即可提前中止请求。
 */

/** 检测窗口：只看最近这么多字符 */
const WINDOW_SIZE = 3000
/** 窗口未填满前不判定，避免短输出误判 */
const MIN_TEXT_LENGTH = 2000
/** 两次检测之间至少新增的字符数，控制开销 */
const CHECK_INTERVAL = 400
/** shingle 长度：按固定长度子串统计重复 */
const SHINGLE_SIZE = 16
/**
 * 唯一 shingle 占比低于该值视为退化。正常的中英文正文、代码通常远高于 0.5；
 * 周期为几十个字符的复读文本会降到 0.05 以下。
 */
const MIN_UNIQUE_RATIO = 0.2

/** 计算文本尾部窗口中唯一 shingle 的占比（0~1），越低说明重复越严重。 */
export function uniqueShingleRatio(text: string): number {
  const window = text.length > WINDOW_SIZE ? text.slice(-WINDOW_SIZE) : text
  const total = window.length - SHINGLE_SIZE + 1
  if (total <= 0) return 1
  const shingles = new Set<string>()
  for (let i = 0; i < total; i++) {
    shingles.add(window.slice(i, i + SHINGLE_SIZE))
  }
  return shingles.size / total
}

/** 判断一段完整文本是否已经退化为复读。 */
export function isDegenerateRepetition(text: string): boolean {
  if (text.length < MIN_TEXT_LENGTH) return false
  return uniqueShingleRatio(text) < MIN_UNIQUE_RATIO
}

/**
 * 流式增量检测器。正文与思考分别累积，任一通道退化即判定。
 */
export class RepetitionDetector {
  private buffers = new Map<string, { text: string; uncheckedLength: number }>()
  private detected = false

  /** 追加增量，返回本次追加后是否检测到退化。 */
  push(channel: string, delta: string): boolean {
    if (this.detected) return true
    if (!delta) return false

    const buffer = this.buffers.get(channel) || { text: '', uncheckedLength: 0 }
    buffer.text += delta
    buffer.uncheckedLength += delta.length
    // 只保留窗口所需的尾部，避免长输出时内存持续增长
    if (buffer.text.length > WINDOW_SIZE * 2) {
      buffer.text = buffer.text.slice(-WINDOW_SIZE)
    }
    this.buffers.set(channel, buffer)

    if (buffer.uncheckedLength < CHECK_INTERVAL) return false
    buffer.uncheckedLength = 0
    this.detected = isDegenerateRepetition(buffer.text)
    return this.detected
  }

  get isDetected(): boolean {
    return this.detected
  }
}

/**
 * 回答末尾声明了「马上要执行的动作」却没有发出工具调用，例如
 * "现在运行 eslint 验证"、"接下来修改 xxx.ts"、"Let me run the tests"。
 * 只检查尾部，避免把总结里对已完成工作的描述误判为承诺。
 */
const PROMISE_TAIL_LENGTH = 160
const PROMISE_PATTERNS = [
  // 中间排除"已/了/过"，避免"现在已经验证通过"之类的完成陈述被误判；
  // 不包含"我会/我将/我可以"，它们多用于"需要的话我会帮你修改"这类结尾提议。
  /(现在|接下来|下一步|马上|立即|让我)[^。！？\n已了过]{0,12}(运行|执行|验证|编译|检查|修改|修复|调用|更新|确认|测试|读取|查看|编辑|创建|写入|构建)/,
  /\b(let me|i'll now|i will now|now i'll|now i will|next,? i'll)\b/i,
]

export function hasUnfulfilledActionPromise(text: string): boolean {
  const tail = text.trim().slice(-PROMISE_TAIL_LENGTH)
  if (!tail) return false
  // 以问句结尾是在征求用户意见，不是未执行的承诺
  if (/[?？]$/.test(tail)) return false
  // 以冒号结尾几乎都是"接下来做 X："这类未完成的引导句
  if (/[:：]$/.test(tail)) return true
  // 只看最后一句，避免总结中段的"现在检查通过"之类陈述被误判
  const lastSentence = tail
    .split(/[。！!\n]|\.\s/)
    .map(sentence => sentence.trim())
    .filter(Boolean)
    .pop()
  if (!lastSentence) return false
  if (/(通过|完成|成功|无误|没有问题)/.test(lastSentence)) return false
  return PROMISE_PATTERNS.some(pattern => pattern.test(lastSentence))
}
