export interface FileReference {
  path: string
  line?: number
  column?: number
  endLine?: number
  endColumn?: number
}

/** 与 Codex 的本地链接约定一致：位置后缀与路径分开解析，避免误拆 Windows 盘符。 */
export function parseFileReference(value: string): FileReference {
  let target = value.trim().replace(/^<([\s\S]*)>$/, '$1').replace(/^`+|`+$/g, '')
  const reference: FileReference = { path: target }
  const hash = target.match(/#L(\d+)(?:C(\d+))?(?:-L?(\d+)(?:C(\d+))?)?$/i)
  const colon = hash ? null : target.match(/:(\d+)(?::(\d+))?(?:[-–](\d+)(?::(\d+))?)?$/)
  const location = hash || colon
  if (location) {
    target = target.slice(0, location.index)
    reference.line = Number(location[1]) || undefined
    reference.column = Number(location[2]) || undefined
    reference.endLine = Number(location[3]) || undefined
    reference.endColumn = Number(location[4]) || undefined
  }

  if (/^file:\/\//i.test(target)) {
    const uri = new URL(target)
    target = `${uri.hostname && uri.hostname !== 'localhost' ? `//${uri.hostname}` : ''}${uri.pathname}`
  }
  try {
    target = decodeURIComponent(target)
  } catch {
    // 无效编码仍按原始文件名查找，不让点击事件异常退出。
  }
  reference.path = target.replace(/^[/\\]([A-Za-z]:[/\\])/, '$1')
  return reference
}
