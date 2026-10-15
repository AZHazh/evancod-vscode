import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  RepetitionDetector,
  hasUnfulfilledActionPromise,
  isDegenerateRepetition,
} from '../core/engine/repetition'

const loopText = '我现在就打破这个循环。工具调用。现在。立即。Execute. Now.\n\n'.repeat(80)

const normalText = Array.from(
  { length: 60 },
  (_, i) =>
    `第 ${i} 步：读取 src/module${i}.ts，确认导出函数 handle${i} 的参数类型与调用方 caller${i} 一致，` +
    `然后在 test/module${i}.test.ts 中补充边界用例 ${i * 7}。`
).join('\n')

describe('repetition detection', () => {
  it('flags degenerate looping output', () => {
    assert.equal(isDegenerateRepetition(loopText), true)
  })

  it('does not flag normal long output', () => {
    assert.ok(normalText.length > 2000)
    assert.equal(isDegenerateRepetition(normalText), false)
  })

  it('does not flag short output', () => {
    assert.equal(isDegenerateRepetition('执行。立即。Now.'.repeat(20)), false)
  })

  it('detects repetition incrementally while streaming', () => {
    const detector = new RepetitionDetector()
    let detectedAt = -1
    for (let i = 0; i < loopText.length; i += 20) {
      if (detector.push('thinking', loopText.slice(i, i + 20))) {
        detectedAt = i
        break
      }
    }
    assert.ok(detectedAt > 0 && detectedAt < 3000, `detected at ${detectedAt}`)
  })

  it('keeps streaming normal output undetected', () => {
    const detector = new RepetitionDetector()
    for (let i = 0; i < normalText.length; i += 20) {
      assert.equal(detector.push('delta', normalText.slice(i, i + 20)), false)
    }
  })
})

describe('unfulfilled action promise', () => {
  it('flags trailing promises without tool calls', () => {
    assert.equal(hasUnfulfilledActionPromise('任务已更新。现在运行 eslint 验证修改。'), true)
    assert.equal(hasUnfulfilledActionPromise('修复完成，接下来编译整个项目：'), true)
    assert.equal(hasUnfulfilledActionPromise('Fixed the hook. Let me run the tests.'), true)
  })

  it('ignores completed summaries and questions', () => {
    assert.equal(hasUnfulfilledActionPromise('所有修改已完成，eslint 检查通过。'), false)
    assert.equal(hasUnfulfilledActionPromise('现在已经验证通过，共修改 3 个文件。'), false)
    assert.equal(hasUnfulfilledActionPromise('需要我接下来修改测试用例吗？'), false)
    assert.equal(
      hasUnfulfilledActionPromise('现在运行了 eslint。\n\n总结：共修改 2 个文件，构建正常。'),
      false
    )
  })
})
