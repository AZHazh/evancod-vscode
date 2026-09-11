import type {
  AttachmentContext,
  InlineMessageSegment,
  RequestContext,
  RequestReference,
} from '../../types'

export interface ComposedUserPrompt {
  instruction: string
  modelContent: string
  references: RequestReference[]
}

/** 保留文件胶囊在原句中的位置，并把它与后置附件正文稳定关联。 */
export function composeUserPrompt(
  content: string,
  segments: InlineMessageSegment[],
  attachments: AttachmentContext[]
): ComposedUserPrompt {
  const references: RequestReference[] = []
  const instruction = segments.length
    ? segments
        .map((segment, index) => {
          if (segment.type === 'text') return segment.text || ''
          if (segment.type === 'skill') {
            const description = segment.description ? `（${segment.description}）` : ''
            return `使用 ${segment.name || ''} 技能${description}，`
          }

          const reference: RequestReference = {
            id: `ref-${index + 1}`,
            path: segment.path || segment.name || '',
            name: segment.name || segment.path || 'file',
            sourceSegmentIndex: index,
          }
          references.push(reference)
          return `<file-ref id="${escapeAttribute(reference.id)}" path="${escapeAttribute(reference.path)}">${escapeText(reference.name)}</file-ref>`
        })
        .join('')
        .trim()
    : content.trim()

  attachments.forEach((attachment, index) => {
    if (references.some(item => samePath(item.path, attachment.path))) return
    references.push({
      id: `ref-attachment-${index + 1}`,
      path: attachment.path,
      name: attachment.name,
      sourceSegmentIndex: -1,
    })
  })

  const attachmentParts = attachments
    .filter(attachment => attachment.kind === 'text')
    .map(attachment => {
      const reference = references.find(item => samePath(item.path, attachment.path))
      const ref = reference ? ` ref="${escapeAttribute(reference.id)}"` : ''
      const suffix = attachment.truncated ? '\n[内容已截断]' : ''
      return `<attachment${ref} path="${escapeAttribute(attachment.path)}" name="${escapeAttribute(attachment.name)}">\n${attachment.text || ''}${suffix}\n</attachment>`
    })

  const nonTextAttachments = attachments.filter(attachment => attachment.kind !== 'text')
  if (nonTextAttachments.length) {
    attachmentParts.push(
      `已附加非文本上下文：\n${nonTextAttachments
        .map(file => {
          const reference = references.find(item => samePath(item.path, file.path))
          return `- [${reference?.id || 'unlinked'}] ${file.path} (${file.kind})`
        })
        .join('\n')}`
    )
  }

  return {
    instruction,
    modelContent: [instruction, ...attachmentParts].filter(Boolean).join('\n\n'),
    references,
  }
}

export function createRequestContext(
  id: string,
  sourceMessageId: string,
  rawContent: string,
  composed: ComposedUserPrompt
): RequestContext {
  const now = new Date().toISOString()
  const sourceText = composed.instruction || rawContent.trim()
  return {
    id,
    sourceMessageId,
    rawContent,
    references: composed.references,
    requirements: sourceText
      ? [
          {
            id: `${id}-requirement-1`,
            sourceText,
            strength: 'explicit',
            referenceIds: composed.references.map(reference => reference.id),
          },
        ]
      : [],
    status: 'active',
    createdAt: now,
    updatedAt: now,
  }
}

export function formatRequestContract(context: RequestContext | undefined): string {
  if (!context) return ''
  const requirements = context.requirements.map(item => `- [${item.id}] ${item.sourceText}`)
  const references = context.references.map(item => `- [${item.id}] ${item.name}: ${item.path}`)
  return [
    '<request_contract>',
    '以下内容来自用户原始请求，不得在任务拆解、实现或总结时弱化：',
    ...requirements,
    ...(references.length ? ['引用文件：', ...references] : []),
    '</request_contract>',
  ].join('\n')
}

/** 简单请求直接使用原文；只有多要求、引用或恢复场景才重复注入结构化契约。 */
export function shouldIncludeRequestContract(
  context: RequestContext | undefined,
  options?: { continuation?: boolean }
): boolean {
  if (!context) return false
  if (options?.continuation || context.references.length > 0) return true

  const source = context.requirements.map(item => item.sourceText).join('\n').trim()
  if (source.length >= 500) return true

  const listedRequirements = source.match(/(?:^|\n)\s*(?:[-*]|\d+[.、)])\s*\S/g) || []
  if (listedRequirements.length >= 2) return true

  return /同时|以及|并且|分别|多(?:个|项|处|文件)|重构|迁移|完整实现/.test(source)
}

function samePath(left: string, right: string): boolean {
  return left.replace(/\\/g, '/').toLowerCase() === right.replace(/\\/g, '/').toLowerCase()
}

function escapeAttribute(value: string): string {
  return escapeText(value).replace(/"/g, '&quot;')
}

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
