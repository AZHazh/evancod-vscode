import type { AttachmentContext, ComposerAttachment, WorkspaceReference } from '@/types'

export function createId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export function fileToComposerAttachment(file: File): Promise<ComposerAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error)
    reader.onload = () => {
      const data = typeof reader.result === 'string' ? reader.result : undefined
      const isImage = file.type.startsWith('image/')
      resolve({
        id: createId(),
        type: isImage ? 'image' : 'file',
        name: file.name,
        mimeType: file.type || 'application/octet-stream',
        size: file.size,
        data,
        previewUrl: isImage ? data : undefined,
      } as ComposerAttachment)
    }
    reader.readAsDataURL(file)
  })
}

export function composerAttachmentToPayload(attachment: ComposerAttachment): string | AttachmentContext {
  if (attachment.path) return attachment.path

  const base64 = attachment.data?.split(',')[1]
  if (attachment.type === 'image' && base64) {
    return {
      path: attachment.name,
      name: attachment.name,
      kind: 'image',
      mime: attachment.mimeType,
      base64,
      size: attachment.size,
      inline: true,
    }
  }

  return {
    path: attachment.name,
    name: attachment.name,
    kind: 'binary',
    mime: attachment.mimeType,
    size: attachment.size || 0,
    inline: true,
  }
}

export function workspaceReferenceToPayload(reference: WorkspaceReference) {
  return reference.path
}
