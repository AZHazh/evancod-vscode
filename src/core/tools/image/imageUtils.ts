/**
 * 图片生成公共工具函数
 *
 * 供 ImageGenTool 和 ChatService（openai_image 直接生图路径）共用。
 */

/**
 * 拼接 OpenAI 图像生成端点 URL。
 * baseUrl 已含 /vN 时直接追加 /images/generations，否则补 /v1/images/generations。
 */
export function buildOpenAIImageUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '')
  if (/\/v\d+$/.test(trimmed)) {
    return `${trimmed}/images/generations`
  }
  return `${trimmed}/v1/images/generations`
}

/**
 * 下载远程图片并转为 base64。
 * 失败时返回 undefined（调用方决定降级）。
 */
export async function downloadAsBase64(url: string): Promise<string | undefined> {
  try {
    console.log('[imageUtils] downloadAsBase64 start:', url.slice(0, 100))
    const res = await fetch(url)
    if (!res.ok) {
      console.warn('[imageUtils] downloadAsBase64 failed, status:', res.status)
      return undefined
    }
    const buf = Buffer.from(await res.arrayBuffer())
    console.log('[imageUtils] downloadAsBase64 success, size:', buf.length, 'bytes')
    return buf.toString('base64')
  } catch (err) {
    console.error('[imageUtils] downloadAsBase64 error:', err)
    return undefined
  }
}
