/**
 * AskUserQuestionTool - 向用户提问工具
 *
 * 职责：
 * AI Agent 调用此工具主动向用户提问，获取用户的选择或输入
 *
 * 使用场景：
 * - 需求不明确时，AI 主动澄清
 * - 多个实现方案，让用户选择
 * - 需要用户提供额外信息
 * - 确认重要决策
 *
 * 支持的问题类型：
 * - 单选：从多个选项中选择一个
 * - 多选：从多个选项中选择多个
 * - 自定义输入：用户自己输入文本
 *
 * 示例：
 * 用户："添加用户认证"
 * AI 不确定使用哪种认证方式，调用：
 * ask_user_question({
 *   question: "请选择认证方式",
 *   options: [
 *     { label: "JWT", description: "使用 JSON Web Token，无状态认证" },
 *     { label: "Session", description: "使用服务器端会话，需要 Redis 或内存存储" },
 *     { label: "OAuth2", description: "使用第三方 OAuth2 提供商" }
 *   ],
 *   allowCustomInput: false
 * })
 *
 * 参数：
 * - question: 问题文本（必需）
 * - options: 选项列表（必需）
 * - allowMultiple: 是否允许多选（可选，默认 false）
 * - allowCustomInput: 是否允许自定义输入（可选，默认 false）
 */

import { Tool, ToolDefinition, ToolResult } from '../base/Tool'


/**
 * 问题选项
 */
export interface QuestionOption {
  /** 选项标签 */
  label: string

  /** 选项描述 */
  description: string

  /** 选项预览内容（可选） */
  preview?: string
}

/**
 * 用户回答
 */
export interface UserAnswer {
  /** 选中的选项标签列表 */
  selectedOptions: string[]

  /** 自定义输入内容（如果允许） */
  customInput?: string
}

/**
 * 问题回调管理器
 * 用于存储等待回答的问题和回调
 */
class QuestionCallbackManager {
  private static instance: QuestionCallbackManager
  private callbacks: Map<string, (answer: UserAnswer) => void> = new Map()

  private constructor() {}

  static getInstance(): QuestionCallbackManager {
    if (!QuestionCallbackManager.instance) {
      QuestionCallbackManager.instance = new QuestionCallbackManager()
    }
    return QuestionCallbackManager.instance
  }

  /**
   * 注册回调
   *
   * @param questionId - 问题 ID
   * @param callback - 回调函数
   */
  registerCallback(questionId: string, callback: (answer: UserAnswer) => void): void {
    this.callbacks.set(questionId, callback)
  }

  /**
   * 触发回调
   *
   * @param questionId - 问题 ID
   * @param answer - 用户回答
   * @returns 是否找到并触发回调
   */
  triggerCallback(questionId: string, answer: UserAnswer): boolean {
    const callback = this.callbacks.get(questionId)
    if (callback) {
      callback(answer)
      this.callbacks.delete(questionId)
      return true
    }
    return false
  }

  /**
   * 取消回调
   *
   * @param questionId - 问题 ID
   */
  cancelCallback(questionId: string): void {
    this.callbacks.delete(questionId)
  }
}

export class AskUserQuestionTool extends Tool {
  readonly name = 'ask_user_question'
  readonly description =
    '向用户提问以获取选择或输入。用于需求不明确、多个方案选择、需要用户决策的场景。支持单选、多选和自定义输入。'

  private callbackManager = QuestionCallbackManager.getInstance()

  /**
   * 获取工具定义
   *
   * @returns Anthropic 工具定义
   */
  getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: this.description,
      input_schema: {
        type: 'object',
        properties: {
          questions: {
            type: 'array',
            description: '要问用户的问题列表（1-4 个问题）。每个问题包含问题文本、选项列表等。',
            items: {
              type: 'object',
              properties: {
                question: {
                  type: 'string',
                  description:
                    '要问用户的问题，清晰、具体。例如："请选择认证方式"、"是否需要添加单元测试？"、"请问 API 的基础路径是什么？"'
                },
                header: {
                  type: 'string',
                  description: '问题的简短标签（最多 12 字符），例如 "认证方式"、"测试"、"API 路径"'
                },
                options: {
                  type: 'array',
                  description:
                    '选项列表。每个选项包含标签和描述。应该提供 2-4 个选项，让用户容易选择。',
                  items: {
                    type: 'object',
                    description: '选项对象，包含标签、描述和可选预览内容。',
                    properties: {
                      label: {
                        type: 'string',
                        description: '选项标签，简短（1-3 个词），例如 "JWT"、"Session"、"是"、"否"'
                      },
                      description: {
                        type: 'string',
                        description:
                          '选项详细描述，解释这个选项的含义、优缺点、影响等，帮助用户做出明智的选择'
                      },
                      preview: {
                        type: 'string',
                        description: '选项预览内容（可选），例如代码片段、配置示例等'
                      }
                    }
                  } as any
                },
                multiSelect: {
                  type: 'boolean',
                  description:
                    '是否允许用户选择多个选项。默认 false（单选）。如果选项不互斥，可以设置为 true。'
                }
              }
            } as any
          }
        },
        required: ['questions']
      }
    }
  }

  /**
   * 执行工具 - 向用户提问
   *
   * @param args - 工具参数
   * @returns 执行结果
   */
  async execute(args: {
    questions: Array<{
      question: string
      header: string
      options: QuestionOption[]
      multiSelect?: boolean
    }>
    answers?: Record<string, UserAnswer>
  }): Promise<ToolResult> {
    try {
      // 参数验证
      if (!args.questions || args.questions.length === 0) {
        return this.createErrorResult('questions 不能为空，至少需要一个问题')
      }

      if (args.questions.length > 4) {
        return this.createErrorResult('questions 最多支持 4 个问题，请精简问题列表')
      }

      // 验证每个问题
      for (let i = 0; i < args.questions.length; i++) {
        const q = args.questions[i]
        if (!q.question || q.question.trim().length === 0) {
          return this.createErrorResult(`问题 ${i + 1} 的 question 不能为空`)
        }
        if (!q.header || q.header.trim().length === 0) {
          return this.createErrorResult(`问题 ${i + 1} 的 header 不能为空`)
        }
        if (!q.options || q.options.length === 0) {
          return this.createErrorResult(`问题 ${i + 1} 的 options 不能为空，至少需要一个选项`)
        }
        if (q.options.length > 4) {
          return this.createErrorResult(`问题 ${i + 1} 的 options 最多支持 4 个选项`)
        }

        // 验证选项
        for (let j = 0; j < q.options.length; j++) {
          const option = q.options[j]
          if (!option.label || option.label.trim().length === 0) {
            return this.createErrorResult(`问题 ${i + 1} 选项 ${j + 1} 的 label 不能为空`)
          }
          if (!option.description || option.description.trim().length === 0) {
            return this.createErrorResult(`问题 ${i + 1} 选项 ${j + 1} 的 description 不能为空`)
          }
        }
      }

      const answers = args.answers
      if (!answers || Object.keys(answers).length === 0) {
        return this.createErrorResult('未收到用户回答')
      }

      // 格式化所有问题的回答
      let content = '✅ 用户已回答\n\n'

      for (let i = 0; i < args.questions.length; i++) {
        const q = args.questions[i]
        const answer = answers[`question_${i}`]

        if (!answer) {
          content += `问题 ${i + 1}: ${q.question}\n未回答\n\n`
          continue
        }

        const selectedText =
          answer.selectedOptions.length > 0
            ? `选择: ${answer.selectedOptions.join(', ')}`
            : '未选择任何选项'

        const customText = answer.customInput ? `\n自定义输入: ${answer.customInput}` : ''

        content += `问题 ${i + 1}: ${q.question}\n${selectedText}${customText}\n\n`
      }

      content += '提示: 根据用户的选择继续执行任务。'

      return this.createSuccessResult(content, { answers })
    } catch (error) {
      return this.createErrorResult(error)
    }
  }

  /**
   * 等待用户回答
   *
   * 此方法会阻塞，直到用户回答问题
   *
   * @param questionId - 问题 ID
   * @returns Promise<UserAnswer> - 用户回答
   */
  private async waitForUserAnswer(questionId: string): Promise<UserAnswer> {
    return new Promise((resolve) => {
      this.callbackManager.registerCallback(questionId, (answer) => {
        resolve(answer)
      })

      // TODO: 发送消息到 Webview，展示问题
      // 当用户回答后，Webview 会发送消息触发回调
    })
  }

  /**
   * 处理用户回答（由外部调用）
   *
   * @param questionId - 问题 ID
   * @param answer - 用户回答
   * @returns 是否成功处理
   */
  static handleUserAnswer(questionId: string, answer: UserAnswer): boolean {
    const manager = QuestionCallbackManager.getInstance()
    return manager.triggerCallback(questionId, answer)
  }

  /**
   * 生成问题 ID
   *
   * @returns 问题 ID
   */
  private generateQuestionId(): string {
    const timestamp = Date.now().toString(36)
    const random = Math.random().toString(36).substring(2, 9)
    return `question-${timestamp}-${random}`
  }
}
