export function formatRelativeTime(value: string | number) {
  const timestamp = typeof value === 'number' ? value : new Date(value).getTime()
  if (!Number.isFinite(timestamp)) return '未知时间'

  const diff = Date.now() - timestamp
  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour

  if (diff < minute) return '刚刚'
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`
  if (diff < 7 * day) return `${Math.floor(diff / day)} 天前`

  return new Date(timestamp).toLocaleDateString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
  })
}
