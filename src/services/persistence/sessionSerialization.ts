import type {
  AgentTranscriptBlock,
  AttachmentContext,
  ContentBlock,
  Session,
} from '../../types'

function attachmentKey(attachment: AttachmentContext): string {
  return [attachment.path, attachment.name, attachment.mime || '', attachment.size].join('\u0000')
}

function cloneContentBlock(block: ContentBlock): ContentBlock {
  return block.source ? { ...block, source: { ...block.source } } : { ...block }
}

/**
 * 会话文件只保留一份用户图片数据：message.attachments 是规范副本，
 * contentBlocks、transcript 和 session.attachments 中的重复 base64 可在读盘时重建。
 */
export function prepareSessionForPersistence(session: Session): Session {
  const canonicalImageKeys = new Set<string>()

  const messages = session.messages.map(message => {
    const attachments = message.attachments?.map(attachment => ({ ...attachment }))
    const imageAttachments = attachments?.filter(
      attachment => attachment.kind === 'image' && !!attachment.base64
    )
    imageAttachments?.forEach(attachment => canonicalImageKeys.add(attachmentKey(attachment)))

    const imageBlocks = message.contentBlocks?.filter(block => block.type === 'image') || []
    const canRebuildImageBlocks =
      imageBlocks.length > 0 &&
      imageBlocks.every((block, index) => {
        const attachment = imageAttachments?.[index]
        return !!attachment?.base64 && (!block.source?.media_type || block.source.media_type === attachment.mime)
      })

    return {
      ...message,
      attachments,
      contentBlocks: message.contentBlocks
        ?.filter(block => !canRebuildImageBlocks || block.type !== 'image')
        .map(cloneContentBlock),
    }
  })

  const stripDuplicateBase64 = (attachment: AttachmentContext): AttachmentContext => {
    if (
      attachment.kind !== 'image' ||
      !attachment.base64 ||
      !canonicalImageKeys.has(attachmentKey(attachment))
    ) {
      return { ...attachment }
    }
    const metadata = { ...attachment }
    delete metadata.base64
    return metadata
  }

  const transcript = session.transcript?.map(block => {
    if (block.type === 'user_text' && block.attachments) {
      return {
        ...block,
        attachments: block.attachments.map(stripDuplicateBase64),
      }
    }
    if (block.type === 'image_generation' && block.image?.path && block.image.base64) {
      const image = { ...block.image }
      delete image.base64
      return { ...block, image }
    }
    return { ...block }
  }) as AgentTranscriptBlock[] | undefined

  return {
    ...session,
    messages,
    transcript,
    attachments: session.attachments?.map(stripDuplicateBase64),
  }
}

/**
 * 把持久化时去掉的图片副本恢复为共享字符串引用，兼容 QueryEngine 和旧版 Webview 数据结构。
 */
export function restoreSessionImageReferences(session: Session): Session {
  const canonicalImages = new Map<string, AttachmentContext>()

  const messages = session.messages.map(message => {
    const attachments = message.attachments?.map(attachment => ({ ...attachment }))
    const imageAttachments = attachments?.filter(
      attachment => attachment.kind === 'image' && !!attachment.base64
    ) || []
    imageAttachments.forEach(attachment => canonicalImages.set(attachmentKey(attachment), attachment))

    if (imageAttachments.length === 0) {
      return {
        ...message,
        attachments,
        contentBlocks: message.contentBlocks?.map(cloneContentBlock),
      }
    }

    const existingBlocks = message.contentBlocks?.map(cloneContentBlock) || [
      { type: 'text' as const, text: message.content },
    ]
    let imageIndex = 0
    const contentBlocks = existingBlocks.map(block => {
      if (block.type !== 'image') return block
      const attachment = imageAttachments[imageIndex++]
      if (!attachment?.base64 || !attachment.mime) return block
      return {
        ...block,
        source: {
          type: 'base64' as const,
          media_type: attachment.mime,
          data: attachment.base64,
        },
      }
    })

    for (; imageIndex < imageAttachments.length; imageIndex++) {
      const attachment = imageAttachments[imageIndex]
      if (!attachment.base64 || !attachment.mime) continue
      contentBlocks.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: attachment.mime,
          data: attachment.base64,
        },
      })
    }

    return { ...message, attachments, contentBlocks }
  })

  const restoreAttachment = (attachment: AttachmentContext): AttachmentContext => {
    const canonical = canonicalImages.get(attachmentKey(attachment))
    return canonical?.base64 && !attachment.base64
      ? { ...attachment, base64: canonical.base64 }
      : { ...attachment }
  }

  const transcript = session.transcript?.map(block =>
    block.type === 'user_text' && block.attachments
      ? { ...block, attachments: block.attachments.map(restoreAttachment) }
      : { ...block }
  ) as AgentTranscriptBlock[] | undefined

  return {
    ...session,
    messages,
    transcript,
    attachments: session.attachments?.map(restoreAttachment),
  }
}
