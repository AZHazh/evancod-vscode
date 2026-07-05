import type { AttachmentContext, ComposerAttachment } from '@/types'

export interface GalleryImage {
  src: string
  name: string
}

/**
 * 从 base64 数据构造可直接用于 <img src> 的 data URL。
 * 若 base64 本身已是 data URL（含 "data:" 前缀）则原样返回。
 */
export function base64ToDataUrl(base64: string, mime?: string): string {
  if (base64.startsWith('data:')) return base64
  const mediaType = mime || 'image/png'
  return `data:${mediaType};base64,${base64}`
}

/**
 * 从消息附件（AttachmentContext）中提取可展示的图片。
 * 仅保留 kind === 'image' 且带有 base64 数据的附件。
 */
export function galleryImagesFromAttachments(
  attachments: AttachmentContext[] | undefined
): GalleryImage[] {
  if (!attachments?.length) return []

  const images: GalleryImage[] = []
  for (const attachment of attachments) {
    if (attachment.kind !== 'image' || !attachment.base64) continue
    images.push({
      src: base64ToDataUrl(attachment.base64, attachment.mime),
      name: attachment.name || fileName(attachment.path) || 'image',
    })
  }
  return images
}

/**
 * 从输入框附件（ComposerAttachment）中提取可展示的图片。
 * 优先使用 previewUrl（本身即 data URL），否则用 data 字段。
 */
export function galleryImagesFromComposer(attachments: ComposerAttachment[]): GalleryImage[] {
  const images: GalleryImage[] = []
  for (const attachment of attachments) {
    if (attachment.type !== 'image') continue
    const src = attachment.previewUrl || attachment.data
    if (!src) continue
    images.push({
      src,
      name: attachment.name || 'image',
    })
  }
  return images
}

/**
 * 从路径或名称中提取文件名。
 */
export function fileName(filePath: string | undefined): string {
  if (!filePath) return ''
  return filePath.split(/[/\\]/).pop() || filePath
}
