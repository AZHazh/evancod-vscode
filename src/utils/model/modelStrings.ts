/**
 * 模型名归一化
 *
 * 将各种格式的模型名转为标准格式，便于能力判断。
 * 例如：
 *   - "claude-opus-4-20250514"       → "claude-opus-4"
 *   - "anthropic.claude-opus-4-v1:0" → "claude-opus-4" (Bedrock ARN)
 *   - "claude-sonnet-4-6@20260101"   → "claude-sonnet-4-6" (Vertex 后缀)
 */
export function getCanonicalName(fullModelName: string): string {
  let normalized = (fullModelName || '').toLowerCase().trim()

  // 移除 Bedrock ARN / region 前缀，只保留 claude-xxx 部分
  if (normalized.includes('anthropic.claude')) {
    normalized = normalized.replace(/^.*anthropic\.claude-/, 'claude-')
    normalized = normalized.replace(/:[0-9]+$/, '') // 移除结尾的 :0 版本号
  }

  // 移除 Vertex 的 @日期 后缀：claude-sonnet-4-6@20260101 → claude-sonnet-4-6
  normalized = normalized.replace(/@\d{6,}$/, '')

  // 移除日期后缀：claude-opus-4-20250514 → claude-opus-4
  normalized = normalized.replace(/-\d{8}$/, '')

  // 移除 v1/v2 后缀
  normalized = normalized.replace(/-v\d+$/, '')

  return normalized
}
