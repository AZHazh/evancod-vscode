import { composeUserPrompt, createRequestContext } from '../UserPromptComposer'

describe('UserPromptComposer', () => {
  it('keeps a file reference at its original position and links the attachment', () => {
    const result = composeUserPrompt(
      '实现参考列表',
      [
        { type: 'text', text: '实现参考 ' },
        { type: 'file', name: 'task-list.vue', path: 'D:\\project\\task-list.vue' },
        { type: 'text', text: ' 列表怎么实现' },
      ],
      [
        {
          path: 'd:\\project\\task-list.vue',
          name: 'task-list.vue',
          kind: 'text',
          text: '<hs-list-page />',
          size: 16,
        },
      ]
    )

    expect(result.instruction).toContain(
      '实现参考 <file-ref id="ref-2" path="D:\\project\\task-list.vue">task-list.vue</file-ref> 列表怎么实现'
    )
    expect(result.modelContent).toContain('<attachment ref="ref-2"')
    expect(result.modelContent).toContain('<hs-list-page />')
  })

  it('stores the complete composed instruction as an immutable explicit requirement', () => {
    const composed = composeUserPrompt(
      '参考文件实现',
      [{ type: 'file', name: 'reference.vue', path: '/project/reference.vue' }],
      []
    )
    const context = createRequestContext('request-1', 'message-1', '参考文件实现', composed)

    expect(context.requirements).toHaveLength(1)
    expect(context.requirements[0].sourceText).toContain('reference.vue')
    expect(context.requirements[0].referenceIds).toEqual(['ref-1'])
    expect(context.status).toBe('active')
  })

  it('escapes file metadata without changing attachment source code', () => {
    const result = composeUserPrompt(
      '',
      [{ type: 'file', name: '<demo>.vue', path: '/project/a&b.vue' }],
      [
        {
          path: '/project/a&b.vue',
          name: '<demo>.vue',
          kind: 'text',
          text: 'const comparison = a < b',
          size: 24,
        },
      ]
    )

    expect(result.instruction).toContain('&lt;demo&gt;.vue')
    expect(result.modelContent).toContain('path="/project/a&amp;b.vue"')
    expect(result.modelContent).toContain('const comparison = a < b')
  })
})
