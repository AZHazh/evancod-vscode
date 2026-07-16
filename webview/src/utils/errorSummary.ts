/**
 * 工具执行错误主旨提取
 *
 * 工具的错误结果（tool_result.content）大多是喂给模型的原始日志：
 * npm error 堆栈、tsc 输出、命令 stderr 等，对用户是噪音。
 * 这里把它归一化成「一句话错因」，原始文本仍可展开查看。
 *
 * 提取策略：先按已知工具链（npm/node、tsc、git、bash exit code）做结构化匹配，
 * 匹配不到再退回「第一行有效文本」，都拿不到才返回 undefined（调用方回退原文）。
 */

/** 从 tool_result.content 中取出可读的原始错误文本 */
export function extractErrorText(content: unknown): string {
  if (typeof content === 'string') return content
  if (content && typeof content === 'object') {
    const record = content as Record<string, unknown>
    // 工具统一封装：{ success:false, error:string, metadata:{...} }
    if (typeof record.error === 'string') return record.error
    if (typeof record.message === 'string') return record.message
    if (typeof record.stderr === 'string') return record.stderr
    try {
      return JSON.stringify(content, null, 2)
    } catch {
      return String(content)
    }
  }
  return String(content ?? '')
}

/** 去掉行首的 `[stderr]`、`npm error`、时间戳等噪音前缀 */
function stripNoise(line: string): string {
  return line
    .replace(/^\s*\[?(stderr|stdout)\]?\s*/i, '')
    .replace(/^\s*npm error\s*/i, '')
    .trim()
}

/**
 * 从原始错误文本中提炼一句话主旨。
 * 返回 undefined 表示提炼不出更精炼的信息，调用方应展示（截断的）原文。
 */
export function summarizeError(content: unknown): string | undefined {
  const raw = extractErrorText(content).trim()
  if (!raw) return undefined

  // 归一化换行，转义的 \n（JSON 里常见）也一起处理
  const text = raw.replace(/\\n/g, '\n').replace(/\r/g, '')
  const lines = text
    .split('\n')
    .map(stripNoise)
    .filter(Boolean)
  if (lines.length === 0) return undefined

  // 1) npm: Missing script / command not found 这类最典型
  const missingScript = text.match(/Missing script:\s*"?([^"\n]+)"?/i)
  if (missingScript) return `npm 缺少脚本: ${missingScript[1].trim()}`

  const commandNotFound = text.match(/([\w./-]+):\s*(?:command not found|not found)/i)
  if (commandNotFound) return `命令未找到: ${commandNotFound[1].trim()}`

  // 2) 退出码：命令执行失败（退出码 N）
  const exitCode = text.match(/退出码[^\d]*(\d+)|exit(?:\s*code)?[^\d]*(\d+)/i)

  // 3) tsc / eslint 等：抓第一条形如 file(line,col): error TSxxxx 的诊断
  const tsError = text.match(/error\s+TS\d+:\s*([^\n]+)/i)
  if (tsError) return `类型错误: ${tsError[1].trim()}`

  // 4) 通用：取第一行有意义的错误文本作为主旨
  const firstMeaningful = lines.find(
    line => !/^A complete log of this run/i.test(line) && !/^To see a list of scripts/i.test(line)
  )

  let summary = firstMeaningful || lines[0]
  if (exitCode) {
    const code = exitCode[1] || exitCode[2]
    // 若主旨本身没提到退出码，补一个，方便判断
    if (code && !/退出码|exit/i.test(summary)) {
      summary = `${summary}（退出码 ${code}）`
    }
  }

  // 主旨过长则截断，避免又变成一大坨
  const MAX = 160
  return summary.length > MAX ? `${summary.slice(0, MAX)}…` : summary
}
