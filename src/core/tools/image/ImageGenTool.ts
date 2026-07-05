/**
 * ImageGenTool - 图像生成工具
 *
 * 支持两条上游路径，按"模型名"自动路由：
 * - OpenAI 兼容：/v1/images/generations（gpt-image-* / dall-e-* 等），
 *   一次性 JSON 响应，Authorization: Bearer。
 * - Gemini：{model}:streamGenerateContent?alt=sse（gemini-*-image 系列），
 *   SSE 流式响应，x-goog-api-key，需 responseModalities:["TEXT","IMAGE"]。
 *
 * 凭证来自当前激活的 Provider（apiKey / baseUrl），与对话共用。
 * Gemini 路径下：若 provider.baseUrl 非 Google 域名，则回退到 AI Studio 官方域名。
 *
 * 返回值约定（与 ToolExecutor / 前端配合）：
 * - content：给 LLM 的纯文本，仅含保存路径等轻量信息（不含 base64）。
 * - metadata.images：图片元信息（路径 / mime），轻量。
 * - metadata._webviewOnly.previews：仅发 Webview 的 base64 预览，
 *   由 ToolExecutor 回灌 LLM 时剔除。
 */

import { Tool, ToolDefinition, ToolResult } from '../base/Tool'
import type { Provider } from '../../../types'
import { saveGeneratedImages, type RawImage } from './imageStorage'

/** 允许的输出尺寸（OpenAI 图像 API 常见取值） */
const ALLOWED_SIZES = ['auto', '1024x1024', '1536x1024', '1024x1536', '1792x1024', '1024x1792']

/** 允许的质量档位 */
const ALLOWED_QUALITIES = ['auto', 'low', 'medium', 'high', 'standard', 'hd']

/** 未显式指定模型时的默认（走 OpenAI 兼容路径） */
const DEFAULT_OPENAI_IMAGE_MODEL = 'gpt-image-2'

/** Gemini AI Studio 官方 Base（provider.baseUrl 非 Google 域名时回退到此） */
const GEMINI_AI_STUDIO_BASE = 'https://generativelanguage.googleapis.com'

/**
 * 判定是否为 Gemini 生图模型。
 * 规则与前端保持宽松一致：gemini- 开头且包含 -image
 * （覆盖 gemini-2.5-flash-image / gemini-3-pro-image 等及其 -preview 变体）。
 */
function isGeminiImageModel(model: string): boolean {
  const m = model.toLowerCase().replace(/^models\//, '')
  return m.startsWith('gemini-') && m.includes('-image')
}

interface ImageGenParams {
  prompt: string
  size?: string
  quality?: string
  n?: number
  model?: string
  output_path?: string
}

export class ImageGenTool extends Tool {
  readonly name = 'image_gen'
  readonly description =
    '根据文本提示词生成图片（AI 绘图）。适用于生成插画、图标、贴图、UI 稿、照片级图像等位图资源。生成的图片会保存到工作区。使用当前激活服务商的 API 凭证，自动按模型名路由到 OpenAI 兼容接口（gpt-image-* 等）或 Gemini 生图接口（gemini-*-image 系列）。'

  /**
   * @param cwd - 工作目录（图片保存的基准路径）
   * @param provider - 当前激活的服务商（提供 apiKey / baseUrl）
   */
  constructor(
    private cwd: string,
    private provider: Provider
  ) {
    super()
  }

  getDefinition(): ToolDefinition {
    return {
      name: this.name,
      description: this.description,
      input_schema: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: '图片的文本描述（提示词）。尽量具体，包含主体、风格、构图、色彩等信息。'
          },
          size: {
            type: 'string',
            description: `图片尺寸，默认 1024x1024（仅 OpenAI 路径生效）。可选：${ALLOWED_SIZES.join(', ')}`,
            enum: ALLOWED_SIZES
          },
          quality: {
            type: 'string',
            description: `生成质量，默认 auto（仅 OpenAI 路径生效）。可选：${ALLOWED_QUALITIES.join(', ')}`,
            enum: ALLOWED_QUALITIES
          },
          n: {
            type: 'number',
            description: '生成图片数量，默认 1（范围 1-4，仅 OpenAI 路径生效）。'
          },
          model: {
            type: 'string',
            description:
              '图像模型名称（可选）。gemini-*-image 系列走 Gemini 生图；gpt-image-* 等走 OpenAI 兼容接口。不填默认使用 OpenAI 兼容模型。'
          },
          output_path: {
            type: 'string',
            description:
              '保存路径（相对工作区，可选）。默认 output/imagegen/image.png。生成多张时会自动追加序号。'
          }
        },
        required: ['prompt']
      }
    }
  }

  async execute(args: ImageGenParams): Promise<ToolResult> {
    try {
      // === 参数校验 ===
      if (!args.prompt || args.prompt.trim().length === 0) {
        return this.createErrorResult('prompt 不能为空')
      }

      // === 校验服务商配置 ===
      if (!this.provider) {
        return this.createErrorResult('未配置服务商（Provider），无法生成图片。请先在设置中配置并激活一个服务商。')
      }
      if (!this.provider.apiKey) {
        return this.createErrorResult(
          `当前服务商 "${this.provider.name}" 未配置 API Key，无法调用图像生成接口。`
        )
      }

      const prompt = args.prompt.trim()
      const model = args.model || DEFAULT_OPENAI_IMAGE_MODEL

      // === 按模型名路由：Gemini 生图 or OpenAI 兼容生图 ===
      let rawImages: RawImage[]
      let meta: string
      if (isGeminiImageModel(model)) {
        const result = await this.generateWithGemini(model, prompt)
        if ('error' in result) return this.createErrorResult(result.error)
        rawImages = result.images
        meta = `模型：${model}（Gemini）`
      } else {
        const result = await this.generateWithOpenAI(model, prompt, args)
        if ('error' in result) return this.createErrorResult(result.error)
        rawImages = result.images
        meta = `模型：${model}\n尺寸：${args.size || '1024x1024'}，质量：${args.quality || 'auto'}`
      }

      if (rawImages.length === 0) {
        return this.createErrorResult('接口未返回可用的图片数据。')
      }

      // === 保存图片到磁盘（两条路径共用） ===
      const previews = await saveGeneratedImages(this.cwd, rawImages, args.output_path)
      if (previews.length === 0) {
        return this.createErrorResult('图片生成成功但未能保存到磁盘。')
      }
      const savedFiles = previews.map((p) => p.path)

      // === 构造给 LLM 的纯文本结果（不含 base64） ===
      const content =
        `已生成 ${savedFiles.length} 张图片并保存到工作区：\n` +
        savedFiles.map((p) => `- ${p}`).join('\n') +
        `\n\n提示词：${prompt}\n${meta}`

      return this.createSuccessResult(content, {
        images: previews.map((p) => ({ path: p.path, name: p.name, mime: p.mime })),
        _webviewOnly: { previews }
      })
    } catch (error) {
      return this.createErrorResult(error)
    }
  }

  // =========================================================================
  // OpenAI 兼容路径：/v1/images/generations（一次性 JSON）
  // =========================================================================

  private async generateWithOpenAI(
    model: string,
    prompt: string,
    args: ImageGenParams
  ): Promise<{ images: RawImage[] } | { error: string }> {
    if (!this.provider.baseUrl) {
      return { error: `当前服务商 "${this.provider.name}" 未配置 Base URL，无法调用图像生成接口。` }
    }

    const size = args.size || '1024x1024'
    const quality = args.quality || 'auto'
    const n = Math.min(Math.max(args.n || 1, 1), 4)
    const url = this.buildOpenAIImageUrl(this.provider.baseUrl)

    let response: Response
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.provider.apiKey}`
        },
        body: JSON.stringify({ model, prompt, n, size, quality, response_format: 'b64_json' })
      })
    } catch (err) {
      return { error: `图像生成请求失败（网络错误）：${err instanceof Error ? err.message : String(err)}` }
    }

    if (!response.ok) {
      const errText = await response.text().catch(() => '')
      return { error: `图像生成接口返回错误 HTTP ${response.status}：${this.truncate(errText, 500)}` }
    }

    const data: any = await response.json()
    const items: any[] = Array.isArray(data?.data) ? data.data : []
    if (items.length === 0) {
      return { error: `接口未返回图片数据。原始响应：${this.truncate(JSON.stringify(data), 500)}` }
    }

    const images: RawImage[] = []
    for (const item of items) {
      const b64 = typeof item?.b64_json === 'string' ? item.b64_json : undefined
      const remoteUrl = typeof item?.url === 'string' ? item.url : undefined
      // 部分服务商忽略 response_format 仍返回 URL，此时下载后转 base64
      const base64 = b64 || (remoteUrl ? await this.downloadAsBase64(remoteUrl) : undefined)
      if (base64) images.push({ base64, mime: 'image/png' })
    }
    return { images }
  }

  // =========================================================================
  // Gemini 路径：{model}:streamGenerateContent?alt=sse（SSE 流式）
  // =========================================================================

  private async generateWithGemini(
    model: string,
    prompt: string
  ): Promise<{ images: RawImage[] } | { error: string }> {
    const base = this.resolveGeminiBase(this.provider.baseUrl)
    const modelId = model.replace(/^models\//, '')
    const url = `${base}/v1beta/models/${modelId}:streamGenerateContent?alt=sse`

    // 生图必需：responseModalities 声明 IMAGE，否则模型不返回图片
    const payload = {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        responseModalities: ['TEXT', 'IMAGE'],
        imageConfig: { aspectRatio: '1:1' }
      }
    }

    let response: Response
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': this.provider.apiKey
        },
        body: JSON.stringify(payload)
      })
    } catch (err) {
      return { error: `Gemini 生图请求失败（网络错误）：${err instanceof Error ? err.message : String(err)}` }
    }

    if (!response.ok || !response.body) {
      const errText = await response.text().catch(() => '')
      return { error: `Gemini 生图接口返回错误 HTTP ${response.status}：${this.truncate(errText, 500)}` }
    }

    return this.parseGeminiStream(response.body)
  }

  /**
   * 解析 Gemini SSE 流，从 candidates[].content.parts[].inlineData 累积 base64 图片。
   * 一次性读完整个流后返回（本工具非流式 emit 模型）。
   */
  private async parseGeminiStream(
    body: ReadableStream<Uint8Array>
  ): Promise<{ images: RawImage[] } | { error: string }> {
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    const images: RawImage[] = []
    let streamError: string | undefined

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      const lines = buffer.split('\n')
      buffer = lines.pop() || '' // 半行留到下一轮

      for (const raw of lines) {
        const line = raw.trim()
        if (!line.startsWith('data:')) continue
        const jsonStr = line.slice(5).trim()
        if (!jsonStr || jsonStr === '[DONE]') continue

        let data: any
        try {
          data = JSON.parse(jsonStr)
        } catch {
          continue
        }

        // 兼容 Gemini CLI 包裹格式：{"response": {...}}
        if (data.response) data = data.response

        if (data?.error?.message) {
          streamError = data.error.message
          continue
        }

        const parts = data?.candidates?.[0]?.content?.parts
        if (!Array.isArray(parts)) continue
        for (const part of parts) {
          const inline = part?.inlineData || part?.inline_data
          const mime = inline?.mimeType || inline?.mime_type
          if (typeof mime === 'string' && mime.toLowerCase().startsWith('image/') && inline?.data) {
            images.push({ base64: inline.data, mime })
          }
        }
      }
    }

    if (images.length === 0 && streamError) {
      return { error: `Gemini 生图失败：${streamError}` }
    }
    return { images }
  }

  // =========================================================================
  // 公共：URL 拼接、辅助
  // =========================================================================

  /**
   * 拼接 OpenAI 图像生成端点 URL。
   * baseUrl 已含 /vN 时直接追加 /images/generations，否则补 /v1/images/generations。
   */
  private buildOpenAIImageUrl(baseUrl: string): string {
    const trimmed = baseUrl.replace(/\/+$/, '')
    if (/\/v\d+$/.test(trimmed)) {
      return `${trimmed}/images/generations`
    }
    return `${trimmed}/v1/images/generations`
  }

  /**
   * 确定 Gemini 请求的 Base URL。
   * 若 provider.baseUrl 指向 Google 生成式 API 域名则复用（去掉尾部 /vN 版本段），
   * 否则回退到 AI Studio 官方域名（对话中转站通常不代理 Gemini 生图）。
   */
  private resolveGeminiBase(baseUrl?: string): string {
    if (baseUrl && /googleapis\.com/i.test(baseUrl)) {
      return baseUrl.replace(/\/+$/, '').replace(/\/v\d+(beta)?$/, '')
    }
    return GEMINI_AI_STUDIO_BASE
  }

  /** 下载远程图片并转为 base64。 */
  private async downloadAsBase64(url: string): Promise<string | undefined> {
    try {
      const res = await fetch(url)
      if (!res.ok) return undefined
      const buf = Buffer.from(await res.arrayBuffer())
      return buf.toString('base64')
    } catch {
      return undefined
    }
  }

  private truncate(value: string, length: number): string {
    return value.length > length ? `${value.slice(0, length)}…` : value
  }
}
