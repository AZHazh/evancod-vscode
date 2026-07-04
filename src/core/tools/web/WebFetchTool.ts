/**
 * WebFetchTool - 网页抓取工具
 *
 * 职责：
 * AI Agent 调用此工具获取网页内容，用于查找文档、最佳实践、错误解决方案
 *
 * 使用场景：
 * - 查找技术文档（如 React、Vue 官方文档）
 * - 查找 API 参考（如 MDN、Node.js 文档）
 * - 查找错误解决方案（如 Stack Overflow）
 * - 研究最佳实践
 *
 * 设计原则：
 * - 支持 HTTP/HTTPS
 * - HTML 自动转换为 Markdown
 * - 支持代理配置
 * - 限制内容长度，避免超出上下文
 *
 * 示例：
 * 用户："查找 React Hooks 的文档"
 * AI 调用：
 * web_fetch({
 *   url: "https://react.dev/reference/react/hooks",
 *   format: "markdown"
 * })
 *
 * 参数：
 * - url: 网页 URL（必需）
 * - format: 返回格式（markdown | html | text）
 * - maxLength: 最大内容长度（可选，默认 10000 字符）
 */

import { Tool, ToolDefinition, ToolResult } from '../base/Tool'
import * as https from 'https'
import * as http from 'http'

/**
 * 返回格式
 */
export type FetchFormat = 'markdown' | 'html' | 'text'

export class WebFetchTool extends Tool {
  readonly name = 'web_fetch'
  readonly description =
    '获取网页内容。用于查找技术文档、API 参考、错误解决方案、最佳实践。支持 HTML 转 Markdown。'

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
          url: {
            type: 'string',
            description:
              '要获取的网页 URL，必须是完整的 URL（包含 http:// 或 https://），例如 "https://react.dev/reference/react/hooks"'
          },
          format: {
            type: 'string',
            description: `返回格式：
- markdown: 将 HTML 转换为 Markdown（默认，推荐用于阅读文档）
- html: 返回原始 HTML（用于需要精确 HTML 结构的场景）
- text: 返回纯文本（用于只需要文字内容的场景）`,
            enum: ['markdown', 'html', 'text']
          },
          maxLength: {
            type: 'number',
            description:
              '返回内容的最大长度（字符数）。默认 10000 字符。如果内容超过此长度会被截断。'
          }
        },
        required: ['url']
      }
    }
  }

  /**
   * 执行工具 - 获取网页
   *
   * @param args - 工具参数
   * @returns 执行结果
   */
  async execute(args: {
    url: string
    format?: FetchFormat
    maxLength?: number
  }): Promise<ToolResult> {
    try {
      // 参数验证
      if (!args.url || args.url.trim().length === 0) {
        return this.createErrorResult('url 不能为空')
      }

      // 验证 URL 格式
      let url: URL
      try {
        url = new URL(args.url)
      } catch (error) {
        return this.createErrorResult(`无效的 URL: ${args.url}`)
      }

      // 只支持 HTTP 和 HTTPS
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return this.createErrorResult(`不支持的协议: ${url.protocol}（只支持 http 和 https）`)
      }

      const format = args.format || 'markdown'
      const maxLength = args.maxLength || 10000

      // 获取网页内容
      const html = await this.fetchUrl(url.toString())

      // 根据格式转换内容
      let content: string
      switch (format) {
        case 'markdown':
          content = this.htmlToMarkdown(html)
          break
        case 'html':
          content = html
          break
        case 'text':
          content = this.htmlToText(html)
          break
        default:
          content = this.htmlToMarkdown(html)
      }

      // 限制长度
      if (content.length > maxLength) {
        content = content.substring(0, maxLength) + '\n\n...\n\n（内容已截断）'
      }

      const result = `✅ 已获取网页内容

URL: ${url.toString()}
格式: ${format}
长度: ${content.length} 字符

---

${content}

---

提示: 如果内容被截断，可以增加 maxLength 参数或使用 grep 搜索特定内容。`

      return this.createSuccessResult(result, {
        url: url.toString(),
        format,
        length: content.length,
        truncated: html.length > maxLength
      })
    } catch (error) {
      return this.createErrorResult(error)
    }
  }

  /**
   * 获取 URL 内容
   *
   * @param url - URL
   * @returns HTML 内容
   */
  private async fetchUrl(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(url)
      const client = urlObj.protocol === 'https:' ? https : http

      const options = {
        method: 'GET',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (compatible; Claude-Agent/1.0; +https://www.anthropic.com)',
          Accept:
            'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7'
        },
        timeout: 30000 // 30 秒超时
      }

      const req = client.get(url, options, (res) => {
        // 处理重定向
        if (res.statusCode === 301 || res.statusCode === 302) {
          const redirectUrl = res.headers.location
          if (redirectUrl) {
            // 递归获取重定向后的内容
            this.fetchUrl(redirectUrl)
              .then(resolve)
              .catch(reject)
            return
          }
        }

        // 检查状态码
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`))
          return
        }

        // 检查内容类型
        const contentType = res.headers['content-type'] || ''
        if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
          reject(new Error(`不支持的内容类型: ${contentType}（只支持 HTML 和纯文本）`))
          return
        }

        // 读取响应内容
        let data = ''
        res.setEncoding('utf8')
        res.on('data', (chunk) => {
          data += chunk
        })
        res.on('end', () => {
          resolve(data)
        })
      })

      req.on('error', (error) => {
        reject(new Error(`网络错误: ${error.message}`))
      })

      req.on('timeout', () => {
        req.destroy()
        reject(new Error('请求超时（30 秒）'))
      })
    })
  }

  /**
   * HTML 转 Markdown（简化版）
   *
   * 这是一个简单的实现，处理常见的 HTML 标签
   *
   * @param html - HTML 内容
   * @returns Markdown 内容
   */
  private htmlToMarkdown(html: string): string {
    // 移除 script 和 style 标签
    let markdown = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    markdown = markdown.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')

    // 标题
    markdown = markdown.replace(/<h1[^>]*>(.*?)<\/h1>/gi, '\n# $1\n')
    markdown = markdown.replace(/<h2[^>]*>(.*?)<\/h2>/gi, '\n## $1\n')
    markdown = markdown.replace(/<h3[^>]*>(.*?)<\/h3>/gi, '\n### $1\n')
    markdown = markdown.replace(/<h4[^>]*>(.*?)<\/h4>/gi, '\n#### $1\n')
    markdown = markdown.replace(/<h5[^>]*>(.*?)<\/h5>/gi, '\n##### $1\n')
    markdown = markdown.replace(/<h6[^>]*>(.*?)<\/h6>/gi, '\n###### $1\n')

    // 链接
    markdown = markdown.replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '[$2]($1)')

    // 粗体和斜体
    markdown = markdown.replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**')
    markdown = markdown.replace(/<b[^>]*>(.*?)<\/b>/gi, '**$1**')
    markdown = markdown.replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*')
    markdown = markdown.replace(/<i[^>]*>(.*?)<\/i>/gi, '*$1*')

    // 代码
    markdown = markdown.replace(/<code[^>]*>(.*?)<\/code>/gi, '`$1`')
    markdown = markdown.replace(/<pre[^>]*>(.*?)<\/pre>/gi, '\n```\n$1\n```\n')

    // 列表
    markdown = markdown.replace(/<li[^>]*>(.*?)<\/li>/gi, '- $1\n')
    markdown = markdown.replace(/<ul[^>]*>/gi, '\n')
    markdown = markdown.replace(/<\/ul>/gi, '\n')
    markdown = markdown.replace(/<ol[^>]*>/gi, '\n')
    markdown = markdown.replace(/<\/ol>/gi, '\n')

    // 段落和换行
    markdown = markdown.replace(/<p[^>]*>/gi, '\n')
    markdown = markdown.replace(/<\/p>/gi, '\n')
    markdown = markdown.replace(/<br\s*\/?>/gi, '\n')
    markdown = markdown.replace(/<div[^>]*>/gi, '\n')
    markdown = markdown.replace(/<\/div>/gi, '\n')

    // 移除所有其他 HTML 标签
    markdown = markdown.replace(/<[^>]+>/g, '')

    // 解码 HTML 实体
    markdown = this.decodeHtmlEntities(markdown)

    // 清理多余空行
    markdown = markdown.replace(/\n{3,}/g, '\n\n')
    markdown = markdown.trim()

    return markdown
  }

  /**
   * HTML 转纯文本
   *
   * @param html - HTML 内容
   * @returns 纯文本内容
   */
  private htmlToText(html: string): string {
    // 移除 script 和 style 标签
    let text = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')

    // 移除所有 HTML 标签
    text = text.replace(/<[^>]+>/g, ' ')

    // 解码 HTML 实体
    text = this.decodeHtmlEntities(text)

    // 清理多余空格
    text = text.replace(/\s+/g, ' ')
    text = text.trim()

    return text
  }

  /**
   * 解码 HTML 实体
   *
   * @param text - 包含 HTML 实体的文本
   * @returns 解码后的文本
   */
  private decodeHtmlEntities(text: string): string {
    const entities: Record<string, string> = {
      '&amp;': '&',
      '&lt;': '<',
      '&gt;': '>',
      '&quot;': '"',
      '&#39;': "'",
      '&nbsp;': ' ',
      '&copy;': '©',
      '&reg;': '®',
      '&trade;': '™'
    }

    return text.replace(/&[a-z0-9#]+;/gi, (entity) => {
      return entities[entity.toLowerCase()] || entity
    })
  }
}
