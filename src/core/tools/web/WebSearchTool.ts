/**
 * WebSearchTool - 网络搜索工具
 *
 * 职责：
 * AI Agent 调用此工具执行网络搜索，查找技术文档、解决方案、最佳实践
 *
 * 使用场景：
 * - 查找技术文档和教程
 * - 查找错误解决方案
 * - 研究技术方案和最佳实践
 * - 获取最新技术信息
 *
 * 设计原则：
 * - 使用 DuckDuckGo 搜索（无需 API Key）
 * - 返回结构化的搜索结果
 * - 包含标题、链接、摘要
 * - 支持结果数量限制
 *
 * 示例：
 * 用户："如何在 TypeScript 中使用泛型"
 * AI 调用：
 * web_search({
 *   query: "TypeScript generics tutorial",
 *   maxResults: 5
 * })
 *
 * 参数：
 * - query: 搜索关键词（必需）
 * - maxResults: 最大结果数量（可选，默认 5）
 */

import { Tool, ToolDefinition, ToolResult } from '../base/Tool'
import * as https from 'https'

/**
 * 搜索结果项
 */
interface SearchResultItem {
  title: string
  url: string
  snippet: string
}

export class WebSearchTool extends Tool {
  readonly name = 'web_search'
  readonly description =
    '执行网络搜索。用于查找技术文档、错误解决方案、最佳实践、最新技术信息。返回标题、链接和摘要。'

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
          query: {
            type: 'string',
            description:
              '搜索关键词，使用英文以获得更好的结果。例如 "React Hooks tutorial"、"TypeScript generics"、"Node.js error handling"'
          },
          maxResults: {
            type: 'number',
            description: '返回的最大结果数量（1-10）。默认 5。更多结果可能包含更多信息，但也会更长。'
          }
        },
        required: ['query']
      }
    }
  }

  /**
   * 执行工具 - 网络搜索
   *
   * @param args - 工具参数
   * @returns 执行结果
   */
  async execute(args: { query: string; maxResults?: number }): Promise<ToolResult> {
    try {
      // 参数验证
      if (!args.query || args.query.trim().length === 0) {
        return this.createErrorResult('query 不能为空')
      }

      const maxResults = Math.min(Math.max(args.maxResults || 5, 1), 10)

      // 执行搜索
      const results = await this.searchDuckDuckGo(args.query, maxResults)

      if (results.length === 0) {
        return this.createSuccessResult(`未找到相关结果\n\n搜索关键词: ${args.query}`, {
          query: args.query,
          count: 0,
          results: []
        })
      }

      // 格式化结果
      const formattedResults = results
        .map(
          (result, index) => `${index + 1}. **${result.title}**
   链接: ${result.url}
   摘要: ${result.snippet}`
        )
        .join('\n\n')

      const content = `✅ 找到 ${results.length} 个搜索结果

搜索关键词: ${args.query}

---

${formattedResults}

---

提示: 使用 web_fetch 工具获取具体网页的完整内容。`

      return this.createSuccessResult(content, {
        query: args.query,
        count: results.length,
        results: results.map((r) => ({
          title: r.title,
          url: r.url,
          snippet: r.snippet
        }))
      })
    } catch (error) {
      return this.createErrorResult(error)
    }
  }

  /**
   * 使用 DuckDuckGo 搜索
   *
   * DuckDuckGo 提供了一个简单的 HTML 搜索接口，无需 API Key
   *
   * @param query - 搜索关键词
   * @param maxResults - 最大结果数
   * @returns 搜索结果列表
   */
  private async searchDuckDuckGo(query: string, maxResults: number): Promise<SearchResultItem[]> {
    // DuckDuckGo HTML 搜索 URL
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`

    try {
      const html = await this.fetchUrl(searchUrl)
      return this.parseDuckDuckGoResults(html, maxResults)
    } catch (error) {
      throw new Error(`搜索失败: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * 解析 DuckDuckGo 搜索结果
   *
   * @param html - HTML 内容
   * @param maxResults - 最大结果数
   * @returns 搜索结果列表
   */
  private parseDuckDuckGoResults(html: string, maxResults: number): SearchResultItem[] {
    const results: SearchResultItem[] = []

    // 使用正则表达式提取搜索结果
    // DuckDuckGo 的 HTML 结构：每个结果在 <div class="result"> 中

    // 提取结果块
    const resultRegex = /<div class="result[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi
    let match

    while ((match = resultRegex.exec(html)) !== null && results.length < maxResults) {
      const resultHtml = match[1]

      // 提取标题和链接
      const titleMatch =
        /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/i.exec(resultHtml)
      if (!titleMatch) continue

      const url = this.decodeUrl(titleMatch[1])
      const title = this.stripHtmlTags(titleMatch[2])

      // 提取摘要
      const snippetMatch = /<a[^>]*class="result__snippet"[^>]*>(.*?)<\/a>/i.exec(resultHtml)
      const snippet = snippetMatch ? this.stripHtmlTags(snippetMatch[1]) : ''

      // 过滤无效结果
      if (url && title && !url.startsWith('//')) {
        results.push({
          title,
          url,
          snippet: snippet || '无摘要'
        })
      }
    }

    return results
  }

  /**
   * 获取 URL 内容
   *
   * @param url - URL
   * @returns HTML 内容
   */
  private async fetchUrl(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const options = {
        method: 'GET',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate'
        },
        timeout: 30000
      }

      const req = https.get(url, options, (res) => {
        // 处理重定向
        if (res.statusCode === 301 || res.statusCode === 302) {
          const redirectUrl = res.headers.location
          if (redirectUrl) {
            this.fetchUrl(redirectUrl)
              .then(resolve)
              .catch(reject)
            return
          }
        }

        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`))
          return
        }

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
        reject(error)
      })

      req.on('timeout', () => {
        req.destroy()
        reject(new Error('请求超时'))
      })
    })
  }

  /**
   * 解码 URL
   *
   * DuckDuckGo 的链接可能是经过编码的
   *
   * @param url - 编码的 URL
   * @returns 解码的 URL
   */
  private decodeUrl(url: string): string {
    try {
      // DuckDuckGo 使用 uddg 参数包含真实 URL
      if (url.includes('uddg=')) {
        const match = /uddg=([^&]+)/.exec(url)
        if (match) {
          return decodeURIComponent(match[1])
        }
      }
      return decodeURIComponent(url)
    } catch {
      return url
    }
  }

  /**
   * 移除 HTML 标签
   *
   * @param html - HTML 内容
   * @returns 纯文本
   */
  private stripHtmlTags(html: string): string {
    // 移除所有 HTML 标签
    let text = html.replace(/<[^>]+>/g, '')

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
      '&trade;': '™',
      '&mdash;': '—',
      '&ndash;': '–',
      '&hellip;': '…'
    }

    return text.replace(/&[a-z0-9#]+;/gi, (entity) => {
      return entities[entity.toLowerCase()] || entity
    })
  }
}
